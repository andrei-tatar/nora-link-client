import {
    EMPTY, Observable, ReplaySubject, catchError, concatMap, filter, finalize,
    first, ignoreElements, map, merge, mergeMap, retry, share, switchMap, takeWhile, timer
} from 'rxjs';
import WebSocket from 'ws';
import { request, OutgoingHttpHeaders, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { stringify as querystringStringify } from 'node:querystring';
import { MessageTypes } from './const';
import { Logger } from './logger';

export interface TunnelOptions {
    remotePath: string;
    url: string;
    label: string;
    removeHostHeader?: boolean;
}

export interface ClientConnectionOptions {
    agent?: string;
    hostname: string;
    secure?: boolean;
    apiKey: string;
    tunnels: TunnelOptions[];
    logger?: Logger;
}

export class Client {
    constructor(
        private options: ClientConnectionOptions) {
    }
    private server$ = new Observable<WebSocket>(observer => {
        const segments = this.options.tunnels.map(v => `${v.remotePath}|${v.label}`);
        const qs = querystringStringify({ s: segments });
        this.options.logger?.info(`[nora-link] connecting`);
        const protocol = this.options.secure ? 'wss' : 'ws';

        const headers = {
            authorization: `Bearer ${this.options.apiKey}`,
            ...(this.options.agent ? {
                'user-agent': this.options.agent,
            } : {}),
        };

        const ws = new WebSocket(`${protocol}://${this.options.hostname}/api/tunnel?${qs}`, { headers });

        ws.on('open', () => {
            this.options.logger?.info(`[nora-link] connected`);
            observer.next(ws);
        });
        ws.on('error', err => observer.error(err));
        ws.on('close', () => observer.complete());

        return () => ws.close();
    }).pipe(
        share({ connector: () => new ReplaySubject(1) }),
    );

    private data$ = this.server$.pipe(
        switchMap(ws => new Observable<Buffer>(observer => {
            const handler = (msg: Buffer) => {
                Buffer.isBuffer(msg) && observer.next(msg);
            };

            ws.on('message', handler);
            ws.once('error', err => observer.error(err));
            ws.once('close', (code, reason) => {
                observer.error(new Error(`${code} - ${reason.toString()}`));
            });
            return () => ws.off('message', handler);
        })),
        map(v => {
            if (v.length >= 5) {
                const id = v.readUint32BE();
                const typeLength = v.readUint8(4);
                const type = v.subarray(5, 5 + typeLength).toString();
                return {
                    id,
                    type,
                    msg: v.subarray(5 + typeLength),
                };
            }
            return null;
        }),
        filter(v => !!v),
        share(),
    );

    readonly handle$ =
        merge(
            this.server$,
            this.data$.pipe(
                mergeMap(({ id, msg, type }) =>
                    type === 'http' || type === 'ws'
                        ? this.httpRequest({
                            type,
                            options: JSON.parse(msg.toString()),
                            data$: this.getStreamData(id),
                            send: (type, msg) => this.send(id, type, msg),
                        })
                        : EMPTY
                ),
            ),
        ).pipe(
            retry({
                resetOnSuccess: true,
                delay: (err, retryCount) => {
                    const delaySeconds = Math.round(Math.min(300, Math.pow(1.8, retryCount + 3)));
                    this.options.logger?.trace(`[nora-link] connection error`, err);
                    this.options.logger?.error(`[nora-link] retrying in ${delaySeconds} sec`);
                    return timer(delaySeconds * 1000);
                },
            }),
            share(),
        );

    send(id: number, type: string, msg?: Buffer) {
        return this.server$.pipe(
            first(),
            switchMap(ws => {
                const header = Buffer.alloc(5);
                const typeBuffer = Buffer.from(type);
                header.writeUint32BE(id);
                header.writeUint8(typeBuffer.length, 4);
                const all = msg
                    ? Buffer.concat([header, typeBuffer, msg])
                    : Buffer.concat([header, typeBuffer]);
                return new Observable<void>(observer => {
                    ws.send(all, (err) => {
                        if (err) observer.error(err);
                        else observer.complete();
                    });
                });
            })
        );
    }

    private getStreamData(id: number) {
        return this.data$.pipe(filter((m) => m.id === id), map(({ id, ...rest }) => rest));
    }

    private httpRequest({ type, options, data$, send }: {
        type: 'ws' | 'http',
        options: { url: string, subdomain: string, method: string, headers: OutgoingHttpHeaders },
        data$: ReturnType<Client['getStreamData']>,
        send: (type: string, msg?: Buffer) => Observable<void>,
    }) {
        const { url, subdomain, method, headers } = options;

        return new Observable<never>(reqObserver => {
            this.options.logger?.trace(`[nora-link] START ${method} ${url}`);

            const tunnel = this.options.tunnels.find(v => v.remotePath === subdomain);
            if (!tunnel) {
                throw new Error(`subdomain ${subdomain} not registered`);
            }

            if (tunnel.removeHostHeader ?? true) {
                delete headers["host"];
            }

            const { hostname, port, pathname } = new URL(tunnel.url);
            const req = request({
                host: hostname,
                port: port,
                path: pathname === '/' ? url : `${pathname}${url}`,
                method,
                headers,
            });

            req.on('error', (err) => reqObserver.error(err));

            if (type === 'ws') {
                req.flushHeaders();

                const handleUpgrade$ = new Observable<{ res: IncomingMessage, socket: Socket }>(observer => {
                    const handler = (res: IncomingMessage, socket: Socket) => {
                        observer.next({ res, socket });
                        observer.complete();
                    };
                    req.once('upgrade', handler);
                    return () => req.off('upgrade', handler);
                }).pipe(
                    concatMap(({ res, socket }) => {
                        const tx$ = new Observable<Observable<void>>(observer => {
                            const head = [
                                `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}`,
                                ...(Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`)),
                                '',
                                '',
                            ].join('\r\n');
                            observer.next(send(MessageTypes.DATA, Buffer.from(head)));

                            socket.on('data', data => {
                                observer.next(send(MessageTypes.DATA, data));
                            });

                            socket.once('end', () => {
                                observer.next(send(MessageTypes.END));

                                //TODO: don't really like this:
                                reqObserver.complete();
                            });

                            socket.once('error', (err) => {
                                observer.error(err);
                            });

                            return () => socket.end();
                        }).pipe(
                            concatMap(obs => obs),
                            ignoreElements(),
                        );

                        const rx$ = data$.pipe(
                            concatMap(({ type, msg }) => new Observable<number>(observer => {
                                switch (type) {
                                    case 'data':
                                        socket.write(msg, err => {
                                            err ? observer.error(err) : observer.complete();
                                        });
                                        break;

                                    case 'end':
                                        socket.end(() => observer.next(1));
                                        break;
                                }
                            })),
                            takeWhile(_ => false),
                            ignoreElements(),
                            finalize(() => {
                                //TODO: don't really like this:
                                reqObserver.complete();
                            }),
                        );

                        return merge(tx$, rx$);
                    }),
                )

                return handleUpgrade$.subscribe(reqObserver);
            }

            if (type === 'http') {
                const handleResponse$ = new Observable<IncomingMessage>(observer => {
                    const handler = (res: IncomingMessage) => {
                        observer.next(res);
                        observer.complete();
                    };
                    req.once('response', handler);
                    return () => req.off('response', handler);
                }).pipe(
                    concatMap((res) => new Observable<Observable<void>>(observer => {
                        const head$ = send(MessageTypes.HEAD, Buffer.from(JSON.stringify({
                            statusCode: res.statusCode,
                            headers: res.headers
                        })));
                        observer.next(head$);

                        const dataHandler = (data: Buffer) => observer.next(send(MessageTypes.DATA, data));
                        res.on('data', dataHandler);

                        res.once('end', () => {
                            observer.next(send(MessageTypes.END));
                            observer.complete();
                        });

                        res.once('error', err => {
                            observer.error(err);
                        });

                        return () => res.off('data', dataHandler);
                    })),
                    concatMap(o => o),
                    ignoreElements(),
                );

                const rx$ = data$.pipe(
                    concatMap(({ type, msg }) => new Observable<number>(observer => {
                        switch (type) {
                            case MessageTypes.DATA:
                                req.write(msg, err => {
                                    err ? observer.error(err) : observer.complete();
                                });
                                break;

                            case MessageTypes.END:
                                req.end(() => observer.next(1));
                                break;
                        }
                    })),
                    takeWhile(_ => false),
                    ignoreElements(),
                );

                return merge(handleResponse$, rx$)
                    .subscribe(reqObserver);
            }

            return () => req.end();
        }).pipe(
            catchError(err => {
                this.options.logger?.warn(`[nora-link] error handling request`, err);
                return send(MessageTypes.BADGATEWAY);
            }),
            finalize(() => {
                this.options.logger?.trace(`[nora-link] DONE ${method} ${url}`);
            }),
        );
    }
}