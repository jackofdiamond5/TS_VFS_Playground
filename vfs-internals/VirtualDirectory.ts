import { ISourceManager } from "../types/ISourceManager";
import { VirtualFile } from "./VirtualFile";
import { FORWARD_SLASH_TOKEN } from "../global-constants";
import path from "path";
import { VFSLanguageService } from "../types";

export class VirtualDirectory {
    public readonly subDirs: Map<string, VirtualDirectory>;
    public readonly files: Map<string, VirtualFile>;
    public readonly path: string = '/';

    constructor(
        public readonly name: string,
        public readonly parentDir: VirtualDirectory | null,
        public readonly sourceManager?: ISourceManager
    ) {
        this.subDirs = new Map<string, VirtualDirectory>();
        this.files = new Map<string, VirtualFile>();
        if (parentDir) {
            this.path = path.posix.join(parentDir.path + FORWARD_SLASH_TOKEN, name);
            this.name = path.posix.normalize(name).substring(name.lastIndexOf(FORWARD_SLASH_TOKEN) + 1) || this.name;
        } else {
            this.name = path.posix.normalize(name);
        }
    }

    public get languageService(): VFSLanguageService | undefined {
        return this.sourceManager?.languageService;
    }

    public findSubDirectory(searchPath: string): VirtualDirectory | undefined {
        const normalizedSearchPath = path.posix.normalize(searchPath);
        const parts = normalizedSearchPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
        let currentDir: VirtualDirectory | undefined = this;

        if (currentDir.path === searchPath) {
            return currentDir;
        }

        for (const part of parts) {
            if (currentDir?.subDirs.has(part)) {
                currentDir = currentDir.subDirs.get(part);
            } else {
                return undefined;
            }
        }

        if (currentDir!.name !== this.name
            && currentDir!.path !== this.path
            && currentDir!.parentDir !== this.parentDir) {
            return currentDir;
        }

        return undefined;
    }

    public addSubDirectory(dirPath: string, sourceManager: ISourceManager): VirtualDirectory {
        const parts = dirPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
        let currentDir: VirtualDirectory = this;
        parts.forEach(part => {
            if (!currentDir.subDirs.has(part)) {
                const newDir = new VirtualDirectory(part, currentDir, sourceManager);
                currentDir.subDirs.set(part, newDir);
                currentDir = newDir;
            } else {
                currentDir = currentDir.subDirs.get(part)!;
            }
        });

        return currentDir;
    }

    public removeSubDirectory(dirPath: string, force: boolean): boolean {
        const parts = dirPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
        let currentDir: VirtualDirectory | undefined = this;
        for (const part of parts) {
            currentDir = currentDir.subDirs.get(part);
            if (!currentDir) return false;
        }

        if (!force && (currentDir.files.size > 0
            || currentDir.subDirs.size > 0)) {
            return false;
        }

        return currentDir?.parentDir?.subDirs.delete(parts.pop()!) || false;
    }

    public findFiles(fileName: string): VirtualFile[] {
        let foundFiles: VirtualFile[] = [];

        if (this.files.has(fileName)) {
            foundFiles.push(this.files.get(fileName)!);
        }

        this.subDirs.forEach(subdir => {
            foundFiles = foundFiles.concat(subdir.findFiles(fileName));
        });

        return foundFiles;
    }

    public findFile(searchPath: string): VirtualFile | null {
        const normalizedSearchPath = path.posix.normalize(searchPath);
        const parts = normalizedSearchPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
        const fileName = parts.pop();

        let containingDir = this.findSubDirectory(parts.join(FORWARD_SLASH_TOKEN));
        if (parts.length === 0) {
            containingDir = this;
        }
        if (fileName && containingDir) {
            return containingDir.files.get(fileName) || null;
        }

        return null;
    }

    public addFile(file: VirtualFile): VirtualFile;
    public addFile(filePath: string | VirtualFile, content: string): VirtualFile;
    public addFile(pathOrFile: string | VirtualFile, content: string = ''): VirtualFile {
        if (pathOrFile instanceof VirtualFile) {
            this.files.set(pathOrFile.name, pathOrFile);
            return pathOrFile;
        }

        const parts = pathOrFile.split(FORWARD_SLASH_TOKEN);
        const fileName = parts.pop();
        const directory = this.addSubDirectory(parts.join(FORWARD_SLASH_TOKEN), this.sourceManager!);

        if (fileName) {
            const newFile = new VirtualFile(fileName, content, directory);
            directory.files.set(fileName, newFile);
            return newFile;
        } else {
            throw new Error('File name must be provided');
        }
    }

    public moveFile(file: VirtualFile, target: VirtualDirectory, newFileName?: string): VirtualFile | null {
        const existingFile = target.files.get(file.name);
        const clone = this.cloneFile(newFileName || file.name, file, target);
        let success = true;
        if (existingFile && !newFileName) {
            success = target.removeFile(existingFile);
        }

        if (success) {
            this.removeFile(file);
            return target.addFile(clone);
        }

        return null;
    }

    public copyFile(file: VirtualFile, target: VirtualDirectory, newFileName?: string): VirtualFile | null {
        let fileName = newFileName || file.name;
        const existingFile = target.files.get(fileName);
        if (existingFile) {
            let counter = 1;
            // clean up any (<number>) elements
            const baseName = fileName.replace(/(\(\d+\))?\.\w+/, '');
            fileName = `${baseName}(${counter}).${file.extension}`;
            while (target.files.has(fileName)) {
                fileName = `${baseName}(${++counter}).${file.extension}`;
            }
        }

        const clone = this.cloneFile(fileName, file, target);
        return target.addFile(clone);
    }

    public removeFile(file: VirtualFile): boolean {
        return this.files.delete(file.name);
    }

    private cloneFile(newFileName: string, file: VirtualFile, target: VirtualDirectory): VirtualFile {
        return new VirtualFile(newFileName, file.content, target);
    }
}
