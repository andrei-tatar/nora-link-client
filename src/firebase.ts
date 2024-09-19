import {
  catchError,
  distinctUntilChanged,
  EMPTY,
  ignoreElements,
  Observable,
  skip,
  startWith,
  switchMap,
  tap,
  timeout,
  TimeoutError,
} from "rxjs";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import {
  getDatabase,
  ref,
  onValue,
  DatabaseReference,
} from "firebase/database";
import { Logger } from "./logger";

export function goIdleAndWaitForSignal(opts: {
  db: string;
  dbKey: string;
  apiKey: string;
  token: string;
  subdomains: string[];
  goOutOfIdle: () => void;
  logger?: Logger;
}): Observable<"idle"> {
  return new Observable<DatabaseReference>((observer) => {
    const app = initializeApp(
      {
        apiKey: opts.apiKey,
      },
      `app-${new Date().getTime()}`
    );
    const auth = getAuth(app);

    signInWithCustomToken(auth, opts.token)
      .then(() => {
        const db = getDatabase(app, opts.db);
        const dbRef = ref(db, opts.dbKey);
        observer.next(dbRef);
      })
      .catch((err) => {
        observer.error(err);
      });

    return () => deleteApp(app);
  }).pipe(
    switchMap(
      (watchRef) =>
        new Observable<Array<number | null>>((observer) =>
          onValue(
            watchRef,
            (snap) => {
              const value: Record<string, number> = snap.val() ?? {};
              observer.next(opts.subdomains.map((s) => value[s] ?? null));
            },
            (err) => {
              observer.error(err);
            }
          )
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
    startWith("idle" as const),
    catchError((err) => {
      if (!(err instanceof TimeoutError)) {
        opts.logger?.error(`[nora-link] idle error ${err}`);
      }
      opts.goOutOfIdle();
      return EMPTY;
    })
  );
}
