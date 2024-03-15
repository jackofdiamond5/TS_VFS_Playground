import ts from "typescript";

export enum FileState {
    New = 'new',
    Modified = 'modified',
    Deleted = 'deleted'
}

export type Optional<T> = {
    [P in keyof T]?: T[P];
};

export type VFSLanguageService = Optional<ts.LanguageService> & Pick<ts.LanguageService, 'getProgram'>;
