import * as fs from "fs";
import { TypeScriptVFS } from "../TypeScriptVirtualFileSystem";
import path from "path";
import { ModuleKind, ScriptTarget } from "typescript";

describe("TypeScript Virtual File System", () => {
  let vfs: TypeScriptVFS;

  function setupTestingDir(parentDir: string, nestedDir: string, nestedFile: string): void {
    fs.mkdirSync(parentDir);
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(nestedFile, "console.log('Hello, world!');");
  }

  function cleanupTestingDir(parentDir: string): void {
    if (fs.existsSync(parentDir)) {
      fs.rmSync(parentDir, { recursive: true });
    }
  }

  describe("Initialization tests", () => {
    beforeEach(() => {
      cleanupTestingDir("testing");
      setupTestingDir("testing", "testing/src", "testing/src/test.ts");
    });

    afterAll(() => {
      cleanupTestingDir("testing");
    });

    it("should Init vfs using relative path", () => {
      vfs = new TypeScriptVFS("./testing");
      expect(vfs.directoryExists("src")).toBeTruthy();
      expect(vfs.fileExists("src/test.ts")).toBeTruthy();
    });

    it("should Init vfs using absolute path", () => {
      const absolutePath = path.posix.join(__dirname, "testing");
      setupTestingDir(absolutePath, path.posix.join(absolutePath, "src"), path.posix.join(absolutePath, "src/test.ts"));
      vfs = new TypeScriptVFS(absolutePath);
      expect(vfs.directoryExists("src")).toBeTruthy();
      expect(vfs.fileExists("src/test.ts")).toBeTruthy();
      cleanupTestingDir(absolutePath);
    });

    it("it should init fs without any arguments", () => {
      vfs = new TypeScriptVFS();
      expect(vfs.rootDir).toBeTruthy();
      expect(vfs.rootDir.subDirs.size).toEqual(0);
      expect(vfs.rootDir.files.size).toEqual(0);
      expect(vfs.rootDir.path).toEqual("/");
    });

    it("it should init fs with different compiler options", () => {
      vfs = new TypeScriptVFS("/", {
        baseUrl: "./src",
        target: ScriptTarget.ES5,
        module: ModuleKind.CommonJS,
        strict: true,
        esModuleInterop: true,
      });
      expect(vfs.rootDir).toBeTruthy();
      expect((vfs as any).sourceManager.compilerOptions.target).toEqual(ScriptTarget.ES5);
      expect((vfs as any).sourceManager.compilerOptions.module).toEqual(ModuleKind.CommonJS);
      expect((vfs as any).sourceManager.compilerOptions.strict).toEqual(true);
      expect((vfs as any).sourceManager.compilerOptions.esModuleInterop).toEqual(true);
      expect((vfs as any).sourceManager.compilerOptions.baseUrl).toEqual("./src");
      expect((vfs as any).sourceManager.compilerOptions.lib.length).toEqual(2);
    });
  });

  describe("File lookup tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
    });

    it("should find a file", () => {
      vfs.createFile("test.ts", "console.log('Hello, world!');");
      expect(vfs.findFile("test.ts")).toBeTruthy();
    });

    it("should return null if a file is not found", () => {
      expect(vfs.findFile("non-existing-file.ts")).toBeNull();
    });

    it("should find a file that is in a nested directory", () => {
      const name = "/src/app/testing/nested-test.ts";
      const content = "console.log('Hello, world!');";
      vfs.createFile(name, content);
      expect(vfs.findFile(name)).toBeTruthy();
    });

    it("should return all files found by glob using a search pattern", () => {
      vfs.createFile("src/app/test.ts", "console.log('Hello, world!');");
      vfs.createFile("src/app/testing/test.ts", "console.log('Hello, world!');");
      vfs.createFile("src/app/testing/nested-test.ts", "console.log('Hello, world!');");
      const files = vfs.glob("src/**/*.ts");
      expect(files.length).toEqual(3);
      expect(files[0]).toEqual("src/app/test.ts");
      expect(files[1]).toEqual("src/app/testing/test.ts");
      expect(files[2]).toEqual("src/app/testing/nested-test.ts");

      const files2 = vfs.glob("/src/app/*.ts");
      expect(files2.length).toEqual(1);
      expect(files2[0]).toEqual("/src/app/test.ts");

      const files3 = vfs.glob("**/test.ts");
      expect(files3.length).toEqual(2);
      expect(files3[0]).toEqual("src/app/test.ts");
      expect(files3[1]).toEqual("src/app/testing/test.ts");
    });
  });

  describe("File creation tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
    });

    it("should create file", () => {
      const name = "test.ts";
      const content = "console.log('Hello, world!');";
      vfs.createFile(name, content);
      expect(vfs.fileExists(name)).toBeTruthy();
      expect(vfs.readFile(name)).toBe(content);
    });

    it("should create a nested file", () => {
      const name = "/src/app/testing/test.ts";
      const content = "console.log('Hello, world!');";
      vfs.createFile(name, content);
      expect(vfs.directoryExists("src")).toBeTruthy();
      expect(vfs.directoryExists("src/app")).toBeTruthy();
      expect(vfs.directoryExists("src/app/testing")).toBeTruthy();
      expect(vfs.fileExists(name)).toBeTruthy();
      expect(vfs.readFile(name)).toBe(content);
    });

    it("should override a file that already exists if an attempt to create it again is made", () => {
      const name = "test.ts";
      const content = "console.log('Hello, world!');";
      vfs.createFile(name, content);
      expect(vfs.fileExists(name)).toBeTruthy();
      expect(vfs.readFile(name)).toBe(content);

      const newContent = "console.log('Hello, world!!!');";
      vfs.createFile(name, newContent);
      expect(vfs.fileExists(name)).toBeTruthy();
      expect(vfs.readFile(name)).toBe(newContent);
    });
  });

  describe("File deletion tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
      vfs.createFile("test.ts", "console.log('Hello, world!');");
    });

    it("should delete an existing file", () => {
      expect(vfs.deleteFile("test.ts")).toEqual(true);
      expect(vfs.fileExists("test.ts")).toBeFalsy();
    });

    it("should delete a file that is in a nested directory", () => {
      const name = "/src/app/testing/nested-test.ts";
      const content = "console.log('Hello, world!');";
      vfs.createFile(name, content);
      expect(vfs.deleteFile(name)).toEqual(true);
      expect(vfs.fileExists(name)).toBeFalsy();
    });

    it("should return false if attempting to delete a non-existing file", () => {
      expect(vfs.deleteFile("non-existing-file.ts")).toEqual(false);
    });
  });

  describe("File reading tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
      vfs.createFile("test.ts", "console.log('Hello, world!');");
    });

    it("should read a file", () => {
      expect(vfs.readFile("test.ts")).toEqual("console.log('Hello, world!');");
    });

    it("should read a file that is in a nested directory", () => {
      const name = "/src/app/testing/nested-test.ts";
      const content = "console.log('Hello, world!');";
      vfs.createFile(name, content);
      expect(vfs.readFile(name)).toEqual(content);
    });

    it("should return null if attempting to read a non-existing file", () => {
      expect(vfs.readFile("non-existing-file.ts")).toBeNull();
    });
  });

  describe("File writing tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
      vfs.createFile("test.ts", "console.log('Hello, world!');");
    });

    it("should write to a file", () => {
      const name = "test.ts";
      const content = "console.log('Hello, world!!!')";
      const file = vfs.writeFile(name, content)!;
      expect(file.content).toEqual(content);
      expect(vfs.readFile(name)).toEqual(content);
    });

    it("should return null if attempting to write to a non-existing file", () => {
      const name = "non-existing-file.ts";
      const content = "console.log('Hello, world!!!')";
      const file = vfs.writeFile(name, content);
      expect(file).toBeNull();
      expect(vfs.readFile(name)).toBeNull();
    });
  });

  describe("File moving tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
      vfs.createFile("test.ts", "console.log('Hello, world!');");
    });

    it("should move a file", () => {
      vfs.addDirectory("src");
      vfs.moveFile("test.ts", "src");
      expect(vfs.fileExists("test.ts")).toBeFalsy();
      expect(vfs.fileExists("src/test.ts")).toBeTruthy();
    });

    it("should return null if attempting to move a non-existing file", () => {
      expect(vfs.moveFile("non-existing-file.ts", "src")).toBeNull();
    });

    it("should return null if attempting to move a file to a non-existing directory", () => {
      expect(vfs.moveFile("test.ts", "non-existing-directory")).toBeNull();
    });

    it("should move the file to a nested directory", () => {
      vfs.addDirectory("src/app/testing");
      vfs.moveFile("test.ts", "src/app/testing");
      expect(vfs.fileExists("test.ts")).toBeFalsy();
      expect(vfs.fileExists("src/app/testing/test.ts")).toBeTruthy();
    });

    it("should return the file if attempting to move a file to the same directory", () => {
      const file = vfs.moveFile("test.ts", "/")!;
      expect(file).toBeTruthy();
      expect(vfs.fileExists("test.ts")).toBeTruthy();

      const fileFromVFS = vfs.findFile("test.ts")!;
      expect(fileFromVFS).toBeTruthy();
      expect(fileFromVFS.name).toEqual(file.name);
      expect(fileFromVFS.path).toEqual(file.path);
      expect(fileFromVFS.content).toEqual(file.content);
      expect(fileFromVFS.parentDir).toEqual(file.parentDir);
    });

    it("should return null if target dir path is not provided", () => {
      expect(vfs.moveFile("test.ts", "")).toBeNull();
    });

    it("should return the file with an updated name if attempting to move a file to the same directory with a different name", () => {
      const file = vfs.moveFile("test.ts", "/", "new-test.ts")!;
      expect(file).toBeTruthy();
      expect(vfs.fileExists("test.ts")).toBeFalsy();
      expect(vfs.fileExists("new-test.ts")).toBeTruthy();

      const fileFromVFS = vfs.findFile("new-test.ts")!;
      expect(fileFromVFS).toBeTruthy();
      expect(fileFromVFS.name).toEqual(file.name);
      expect(fileFromVFS.path).toEqual(file.path);
      expect(fileFromVFS.content).toEqual(file.content);
      expect(fileFromVFS.parentDir).toEqual(file.parentDir);
    });

    it("should override the file if attempting to move a file to a directory that already contains a file with the same name", () => {
      vfs.createFile("src/new-test.ts", "console.log('Hello, world!!!')");
      const file = vfs.moveFile("test.ts", "src", "new-test.ts");
      expect(file).toBeTruthy();
      expect(vfs.fileExists("test.ts")).toBeFalsy();
      expect(vfs.fileExists("src/new-test.ts")).toBeTruthy();
      expect(vfs.readFile("src/new-test.ts")).toEqual(
        "console.log('Hello, world!');"
      );
    });
  });

  describe("File copying tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
      vfs.createFile("test.ts", "console.log('Hello, world!');");
    });

    it("should copy a file", () => {
      vfs.addDirectory("src");
      vfs.copyFile("test.ts", "src");
      expect(vfs.fileExists("test.ts")).toBeTruthy();
      expect(vfs.fileExists("src/test.ts")).toBeTruthy();
      const original = vfs.findFile("test.ts")!;
      const copy = vfs.findFile("src/test.ts")!;
      expect(original.name).toEqual(copy.name);
      expect(original.content).toEqual(copy.content);
      expect(original.parentDir).not.toEqual(copy.parentDir);
      expect(original.path).not.toEqual(copy.path);
    });

    it("should return null if attempting to copy a non-existing file", () => {
      expect(vfs.copyFile("non-existing-file.ts", "src")).toBeNull();
    });

    it("should return null if attempting to copy a file to a non-existing directory", () => {
      expect(vfs.copyFile("test.ts", "non-existing-directory")).toBeNull();
    });

    it("should return the new file if attempting to copy a file to the same directory with a different name", () => {
      const copy = vfs.copyFile("test.ts", "/", "new-test.ts")!;
      expect(copy).toBeTruthy();
      expect(vfs.fileExists("test.ts")).toBeTruthy();
      expect(vfs.fileExists("new-test.ts")).toBeTruthy();

      const original = vfs.findFile("test.ts")!;
      expect(original).toBeTruthy();
      expect(original.name).not.toEqual(copy.name);
      expect(original.path).not.toEqual(copy.path);
      expect(original.content).toEqual(copy.content);
      expect(original.parentDir).toEqual(copy.parentDir);
    });

    it("should increment the file's name if attempting to copy a file to a directory that already contains a file with the same name", () => {
      const copy = vfs.copyFile("test.ts", "/")!;
      expect(copy).toBeTruthy();
      expect(copy.name).toEqual("test(1).ts");
      const copy1 = vfs.copyFile("test(1).ts", "/")!;
      expect(copy1).toBeTruthy();
      expect(copy1.name).toEqual("test(2).ts");
    });

    it(
      "should increment the file's name if attempting to copy a file to a directory and providing" +
        " a new name while the directory already contains a file with the same name",
      () => {
        const copy = vfs.copyFile("test.ts", "/", "new-test.ts")!;
        expect(copy).toBeTruthy();
        expect(copy.name).toEqual("new-test.ts");
        const copy1 = vfs.copyFile("test.ts", "/", "new-test.ts")!;
        expect(copy1).toBeTruthy();
        expect(copy1.name).toEqual("new-test(1).ts");
      }
    );

    it("should copy the file to a nested directory", () => {
      vfs.addDirectory("src/app/testing");
      vfs.copyFile("test.ts", "src/app/testing");
      expect(vfs.fileExists("test.ts")).toBeTruthy();
      expect(vfs.fileExists("src/app/testing/test.ts")).toBeTruthy();
    });

    it("should return null if target dir path is not provided", () => {
      expect(vfs.copyFile("test.ts", "")).toBeNull();
    });
  });

  describe("Directory lookup tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
      vfs.addDirectory("src");
    });

    it("should find a directory", () => {
      expect(vfs.findDirectory("src")).toBeTruthy();
    });

    it("should return null if a directory is not found", () => {
      expect(vfs.findDirectory("non-existing-directory")).toBeNull();
    });

    it("should find a directory that is in a nested directory", () => {
      vfs.addDirectory("src/app/testing");
      expect(vfs.findDirectory("src/app/testing")).toBeTruthy();
    });
  });

  describe("Directory creation tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
    });

    it("should create a directory", () => {
      const newDir = vfs.addDirectory("src");
      expect(newDir).toBeTruthy();
      expect(newDir.parentDir).toBe(vfs.rootDir);
    });

    it("should create nested directory", () => {
      const newDir = vfs.addDirectory("src/app/testing");
      expect(newDir).toBeTruthy();
      expect(newDir.parentDir).toBe(vfs.findDirectory("src/app")!);
    });

    it("should return the directory if attempting to create a directory that already exists", () => {
      const newDir = vfs.addDirectory("src");
      expect(newDir).toBeTruthy();
      expect(newDir.parentDir).toBe(vfs.rootDir);
      const existingDir = vfs.addDirectory("src");
      expect(existingDir).toBeTruthy();
      expect(existingDir).toBe(newDir);
    });
  });

  describe("Directory deletion tests", () => {
    beforeEach(() => {
      vfs = new TypeScriptVFS();
      vfs.addDirectory("src");
    });

    it("should delete a directory", () => {
      expect(vfs.removeDirectory("src")).toBeTruthy();
      expect(vfs.directoryExists("src")).toBeFalsy();
    });

    it("should delete nested directory", () => {
      vfs.addDirectory("src/app/testing");
      expect(vfs.removeDirectory("src/app/testing")).toBeTruthy();
      expect(vfs.directoryExists("src/app/testing")).toBeFalsy();
    });

    it("should return false if attempting to delete a non-existing directory", () => {
      expect(vfs.removeDirectory("non-existing-directory")).toBeFalsy();
    });

    it("should return false if attempting to delete a non-empty directory", () => {
      vfs.addDirectory("src/app/testing");
      expect(vfs.removeDirectory("src")).toBeFalsy();
      expect(vfs.directoryExists("src")).toBeTruthy();
    });

    it("should return false if attempting to delete a directory that contains files", () => {
      vfs.createFile("src/test.ts", "console.log('Hello, world!');");
      expect(vfs.removeDirectory("src")).toBeFalsy();
      expect(vfs.directoryExists("src")).toBeTruthy();
    });

    it("should successfully delete a directory that contains files if force is set to true", () => {
      vfs.createFile("src/test.ts", "console.log('Hello, world!');");
      expect(vfs.removeDirectory("src", true)).toBeTruthy();
      expect(vfs.directoryExists("src")).toBeFalsy();
    });

    it("should successfully delete a directory that contains nested directories if force is set to true", () => {
      vfs.addDirectory("src/app/testing");
      vfs.createFile("src/test.ts", "console.log('Hello, world!');");
      expect(vfs.removeDirectory("src", true)).toBeTruthy();
      expect(vfs.directoryExists("src")).toBeFalsy();
    });
  });

  describe("Finalization tests", () => {
    beforeEach(() => {
      cleanupTestingDir("testing");
      setupTestingDir("testing", "testing/src", "testing/src/test.ts");
      vfs = new TypeScriptVFS("./testing");
    });

    afterAll(() => {
      cleanupTestingDir("testing");
    });

    it("should add new files to the physical representation of the vfs", () => {
      vfs.addDirectory("src/app");
      const content = "console.log('Hello, world!!!');";
      vfs.createFile("src/app/another-test.ts", content);
      vfs.finalize();

      expect(fs.existsSync("./testing/src/app")).toBeTruthy();
      expect(fs.existsSync("./testing/src/app/another-test.ts")).toBeTruthy();
      expect(fs.readFileSync("./testing/src/app/another-test.ts", "utf8")).toEqual(content);
      expect(fs.existsSync("./testing/src/test.ts")).toBeTruthy();
    });

    it("should update the contents of the files in the physical representation of the vfs", () => {
      const content = "console.log('Hello, world!!!');";
      vfs.writeFile("src/test.ts", content);
      vfs.finalize();

      expect(fs.existsSync("./testing/src/test.ts")).toBeTruthy();
      expect(fs.readFileSync("./testing/src/test.ts", "utf8")).toEqual(content);
    });

    it("should remove files from the physical representation of the vfs", () => {
      vfs.deleteFile("src/test.ts");
      vfs.finalize();

      expect(fs.existsSync("./testing/src/test.ts")).toBeFalsy();
    });

    it("should dump the vfs to a relative directory", () => {
      vfs.finalize("./testing-dump");
      expect(fs.existsSync("./testing-dump/testing/src/test.ts")).toBeTruthy();
      fs.rmdirSync("./testing-dump", { recursive: true });
    });

    it("should dump the vfs to an absolute directory", () => {
      const absolutePath = path.posix.join(__dirname, "testing-dump");
      vfs.finalize(absolutePath);
      expect(fs.existsSync(path.posix.join(__dirname, "testing-dump/testing/src/test.ts"))).toBeTruthy();
      fs.rmdirSync(absolutePath, { recursive: true });
    });
  });
});
