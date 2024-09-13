import {
    BehaviorSubject,
    EMPTY, Observable, ReplaySubject, catchError, concat, concatMap, delay, filter, finalize,
    first, ignoreElements, map, merge, mergeMap, of, retry, share, startWith, switchMap,
    takeWhile, tap, throwError, timer
} from 'rxjs';
import WebSocket from 'ws';
import { request, OutgoingHttpHeaders, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { stringify as querystringStringify } from 'node:querystring';
import { MessageTypes } from './const';
import { Logger } from './logger';
import { goIdleAndWaitForSignal } from './firebase';
import { randomBytes } from 'node:crypto';

export interface TunnelOptions {
    subdomain: string;
    url: string;
    label: string;
    removeHostHeader?: boolean;
}

export interface ClientConnectionOptions {
    agent?: string;
    hostname?: string;
    secure?: boolean;
    apiKey: string;
    tunnels: TunnelOptions[];
    logger?: Logger;
    clientId?: string;
}

export class Client {

    private retryCount = 1;
    private clientId;

    constructor(
        private options: ClientConnectionOptions) {

        if (!options.agent) {
            const { name, version } = require('../package.json');
            options.agent = `${name}@${version}`;
        }

        this.clientId = options.clientId ?? randomBytes(16).toString('base64url');
    }

    private server$ = new Observable<WebSocket>(observer => {
        const subdomains = this.options.tunnels.map(v => `${v.subdomain}|${v.label}`);
        const qs = querystringStringify({ s: subdomains, c: this.clientId });
        const protocol = (this.options.secure ?? true) ? 'wss' : 'ws';

        const headers = {
            authorization: `Bearer ${this.options.apiKey}`,
            ...(this.options.agent ? {
                'user-agent': this.options.agent,
            } : {}),
        };

        const hostname = this.options.hostname ?? 'noralink.eu';
        const ws = new WebSocket(`${protocol}://${hostname}/api/tunnel?${qs}`, {
            headers,
            followRedirects: true,
        });

        ws.on('open', () => {
            observer.next(ws);
        });
        ws.on('error', (err) => {
            observer.error(err);
        });
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
            const errorHandler = (err: any) => observer.error(err);
            const closeHandler = (code: number, reason: Buffer) => {
                observer.error(new Error(`${code} - ${reason.toString()}`));
            };

            ws.on('message', handler);
            ws.once('error', errorHandler);
            ws.once('close', closeHandler);
            return () => {
                ws.off('message', handler);
                ws.off('error', errorHandler);
                ws.off('close', closeHandler);
                ws.close();
            };
        })),
        map(v => {
            if (v.length < 18) {
                return null;
            }

            let offset = 0;

            const version = v.readUInt8(offset++);
            if (version !== 1) {
                return null;
            }

            const id = v.subarray(offset, offset + 16);
            offset += 16;
            const typeLength = v.readUint8(offset++);
            const type = v.subarray(offset, offset + typeLength).toString();
            offset += typeLength;
            const msg = v.subarray(offset);

            return {
                id,
                type,
                msg,
            };
        }),
        filter(v => !!v),
        share(),
    );

    private readonly connectToServer$ = merge(
        this.server$.pipe(
            //wait a bit before deeming `connected`. Server might close the connection for various reasons.
            delay(500),
            tap(() => {
                this.retryCount = 1;
            }),
            map(_ => 'connected' as const),
        ),
        this.data$.pipe(
            mergeMap(({ id, msg, type }) => {

                switch (type) {
                    case 'http':
                    case 'ws':
                        return this.httpRequest({
                            type,
                            options: JSON.parse(msg.toString()),
                            data$: this.getStreamData(id),
                            send: (type, msg) => this.send(id, type, msg),
                        });

                    case 'go-idle':
                        const { db, dbKey, apiKey, token } = JSON.parse(msg.toString());
                        this.idle$.next({ db, dbKey, apiKey, token });
                        break;
                }
                return EMPTY;
            }),
        ),
    ).pipe(
        startWith('connecting' as const),
        catchError(err => concat(
            of('disconnected' as const),
            throwError(() => err),
        )),
        retry({
            delay: (err) => {
                const delaySeconds = Math.round(Math.min(600, Math.pow(1.8, this.retryCount - 1)));
                this.options.logger?.error(`[nora-link] connection error ${this.retryCount}: ${err}`);
                this.options.logger?.info(`[nora-link] retrying in ${delaySeconds} sec`);
                this.retryCount++;
                return timer(delaySeconds * 1000);
            },
        }),
        share(),
    );

    readonly idle$ = new BehaviorSubject<null | { db: string, dbKey: string, apiKey: string, token: string }>(null);

    readonly handle$: Observable<'connected' | 'connecting' | 'disconnected' | 'idle'> = this.idle$.pipe(
        switchMap(idle => idle
            ? goIdleAndWaitForSignal({
                ...idle,
                subdomains: this.options.tunnels.map(t => t.subdomain),
                goOutOfIdle: () => this.idle$.next(null),
                logger: this.options.logger,
            })
            : this.connectToServer$
        ),
    );

    private send(id: Buffer, type: string, msg?: Buffer) {
        return this.server$.pipe(
            first(),
            switchMap(ws => {
                const typeBuffer = Buffer.from(type);
                let offset = 0;
                const all = Buffer.alloc(18 + typeBuffer.length + (msg?.length ?? 0));
                offset = all.writeUint8(1, offset);
                offset += id.copy(all, offset, 0, 16);
                offset = all.writeUint8(typeBuffer.length, offset);
                offset += typeBuffer.copy(all, offset);
                msg?.copy(all, offset);
                return new Observable<never>(observer => {
                    ws.send(all, (err) => {
                        if (err) observer.error(err);
                        else observer.complete();
                    });
                });
            })
        );
    }

    private getStreamData(id: Buffer) {
        return this.data$.pipe(
            filter((m) => m.id.equals(id)),
            map(({ id, ...rest }) => rest)
        );
    }

    private httpRequest({ type, options, data$, send }: {
        type: 'ws' | 'http',
        options: { url: string, subdomain: string, method: string, headers: OutgoingHttpHeaders },
        data$: ReturnType<Client['getStreamData']>,
        send: (type: string, msg?: Buffer) => Observable<never>,
    }) {
        const { url, subdomain, method, headers } = options;

        return new Observable<never>(reqObserver => {
            this.options.logger?.trace(`[nora-link] START ${method} ${url}`);

            const tunnel = this.options.tunnels.find(v => v.subdomain === subdomain);
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
                this.options.logger?.warn(`[nora-link] error handling request: ${err}`);
                return send(MessageTypes.BADGATEWAY);
            }),
            finalize(() => {
                this.options.logger?.trace(`[nora-link] DONE ${method} ${url}`);
            }),
        );
    }
}