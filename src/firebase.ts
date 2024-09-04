import {
    catchError, defer, distinctUntilChanged, EMPTY, ignoreElements, Observable,
    skip, startWith, switchMap, tap, timeout, TimeoutError
} from "rxjs";
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCustomToken } from 'firebase/auth'
import { getDatabase, ref, onValue } from 'firebase/database'
import { Logger } from "./logger";

export function goIdleAndWaitForSignal(opts: {
    db: string,
    dbKey: string,
    apiKey: string,
    token: string,
    subdomains: string[],
    goOutOfIdle: () => void,
    logger?: Logger,
}): Observable<'idle'> {
    return defer(async () => {
        const app = initializeApp({
            apiKey: opts.apiKey,
        }, `app-${new Date().getTime()}`);
        const auth = getAuth(app);
        await signInWithCustomToken(auth, opts.token);

        const db = getDatabase(app, opts.db);
        return ref(db, opts.dbKey);
    }).pipe(
        switchMap((watchRef) =>
            new Observable<Array<number | null>>(observer =>
                onValue(watchRef, snap => {
                    const value: Record<string, number> = snap.val() ?? {};
                    observer.next(opts.subdomains.map(s => value[s] ?? null));
                }, (err) => {
                    observer.error(err);
                })
            )
        ),
        distinctUntilChanged((a, b) => {
            for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) {
                    return false;
                }
            }
            return true;
        }),
        skip(1),
        timeout(3600 * 1000),
        tap(() => opts.goOutOfIdle()),
        ignoreElements(),
        startWith('idle' as const),
        catchError(err => {
            if (!(err instanceof TimeoutError)) {
                opts.logger?.error(`[nora-link] idle error ${err}`);
            }
            opts.goOutOfIdle();
            return EMPTY;
        }),
    );
}