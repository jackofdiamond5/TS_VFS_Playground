import { LanguageService } from "typescript";

export type Optional<T> = {
    [P in keyof T]?: T[P];
};

export type VFSLanguageService = Optional<LanguageService> & Pick<LanguageService, 'getProgram'>;
