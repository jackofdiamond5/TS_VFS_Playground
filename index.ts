import { TypeScriptVFS } from "./TypeScriptVirtualFIleSystem";

const dir1 = "C:/Users/bpenkov/Downloads/empty-webcomponents-project"
const dir2 = "../CodeGen/Source/WebService/bin/Debug/net6.0/empty-webcomponents-project";
const dir3 = "C:/Users/bpenkov/Desktop/MyReactProject";
const vfs = new TypeScriptVFS(dir3);

const file = vfs.findFile("src/app/app-routing.ts");
const l = file?.parentDir.languageService?.getDefinitionAndBoundSpan!('', 0)

// const sf = file?.sourceFile;
// const c = vfs.finalize("C:/Users/bpenkov/Downloads");
// const fileRefs = file?.parentDir.languageService?.getFileReferences(file.path);
// const sourceFiles = vfs.getSourceFiles();
// const a = 5;

vfs.createFile("/src/testing.ts", "const test = 5;");
vfs.writeFile("src/testing.ts", "const test = 6;");


vfs.createFile("rootTesting.ts", "const rootTesting = 5;");
vfs.deleteFile("rootTesting.ts");

vfs.deleteFile("src/index.ts");

vfs.finalize();
// vfs.deleteFile("testing.ts");
// const test = vfs.directoryExists("src");
const b = 6;
