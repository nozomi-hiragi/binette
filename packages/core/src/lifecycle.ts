/** Réplique の State・DestroyKind・DestroyCause と同じ番号 */
export enum State { None, Create, Start, Resume, Pause, Stop, Destroy }
export enum DestroyKind { User, System }
export enum DestroyCause { Os, App, Stack, Update, Uninstall }
