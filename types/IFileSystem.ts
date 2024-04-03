export interface IFileSystem {
    fileExists(filePath: string): boolean;
    readFile(filePath: string, encoding?: string): string | null;
    writeFile(filePath: string, text: string): void;
    directoryExists(dirPath: string): boolean;

    /**
     * Returns a list of file paths under a directory based on a match pattern
     * @param dirPath Root dir to search in
     * @param pattern Pattern to match
     */
    glob(dirPath: string, pattern: string): string[];
}
