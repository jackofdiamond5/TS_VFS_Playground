import * as ts from "typescript";
import { TypeScriptASTTransformer } from "../vfs-internals/TypeScriptASTTransformer";

const FILE_NAME = "test-file.ts";
let FILE_CONTENT = ``;

describe("TypeScript source update", () => {
  let sourceFile: ts.SourceFile;
  let astTransformer: TypeScriptASTTransformer;

  const printer = ts.createPrinter();

  describe("General", () => {
    it("should find a variable declaration by given name & type", () => {
      FILE_CONTENT = `const myVar: string = "hello";`;
      sourceFile = ts.createSourceFile(
        FILE_NAME,
        FILE_CONTENT,
        ts.ScriptTarget.Latest,
        true
      );
      astTransformer = new TypeScriptASTTransformer(sourceFile);

      const result = astTransformer.findVariableDeclaration("myVar", "string");
      expect(result).toBeDefined();
    });

    it("should find an exported variable declaration by given name & type", () => {
      FILE_CONTENT = `export const myVar: string = "hello";`;
      sourceFile = ts.createSourceFile(
        FILE_NAME,
        FILE_CONTENT,
        ts.ScriptTarget.Latest,
        true
      );
      astTransformer = new TypeScriptASTTransformer(sourceFile);

      const result = astTransformer.findVariableDeclaration("myVar", "string");
      expect(result).toBeDefined();
    });

    it("should create a call expression", () => {
      sourceFile = ts.createSourceFile(
        FILE_NAME,
        FILE_CONTENT,
        ts.ScriptTarget.Latest,
        true
      );
      astTransformer = new TypeScriptASTTransformer(sourceFile);

      const typeArg = ts.factory.createKeywordTypeNode(
        ts.SyntaxKind.NumberKeyword
      );
      const arg = ts.factory.createNumericLiteral("5");
      const callExpression = astTransformer.createCallExpression(
        "x",
        "myGenericFunction",
        [typeArg],
        [arg]
      );

      const result = printer.printNode(
        ts.EmitHint.Unspecified,
        callExpression,
        sourceFile
      );
      expect(result).toEqual(`x.myGenericFunction<number>(5)`);
    });
  });

  describe("Object literals", () => {
    beforeEach(() => {
      FILE_CONTENT = `const myObj = { key1: "hello", key2: "world" };`;
      sourceFile = ts.createSourceFile(
        FILE_NAME,
        FILE_CONTENT,
        ts.ScriptTarget.Latest,
        true
      );
      astTransformer = new TypeScriptASTTransformer(sourceFile);
    });

    it("should add member to an object literal", () => {
      const updatedSourceFile = astTransformer.addMemberToObjectLiteral(
        ts.isObjectLiteralExpression,
        "key3",
        ts.factory.createStringLiteral("new-value")
      );

      const result = printer.printFile(updatedSourceFile);
      expect(result).toEqual(
        `const myObj = { key1: "hello", key2: "world", key3: "new-value" };\n`
      );
    });

    it("should add member to an object literal with an IPropertyAssignment", () => {
      const updatedSourceFile = astTransformer.addMemberToObjectLiteral(
        ts.isObjectLiteralExpression,
        { name: "key3", value: ts.factory.createStringLiteral("new-value") }
      );
      const result = printer.printFile(updatedSourceFile);
      expect(result).toEqual(
        `const myObj = { key1: "hello", key2: "world", key3: "new-value" };\n`
      );
    });

    it("should update am existing member of an object literal", () => {
      const updatedSourceFile = astTransformer.updateObjectLiteralMember(
        ts.isObjectLiteralExpression,
        { name: "key2", value: ts.factory.createStringLiteral("new-value") }
      );
      const result = printer.printFile(updatedSourceFile);
      expect(result).toEqual(
        `const myObj = { key1: "hello", key2: "new-value" };\n`
      );
    });

    it("should not update a non-existing member of an object literal", () => {
      const updatedSourceFile = astTransformer.updateObjectLiteralMember(
        ts.isObjectLiteralExpression,
        { name: "key3", value: ts.factory.createStringLiteral("new-value") }
      );
      const result = printer.printFile(updatedSourceFile);
      expect(result).toEqual(
        `const myObj = { key1: "hello", key2: "world" };\n`
      );
    });

    it("should not update an object literal if the target node is dynamically added and not yet part of the AST", () => {
      spyOn(astTransformer, "flush").and.callFake(() => sourceFile);

      astTransformer.addMemberToObjectLiteral(
        ts.isObjectLiteralExpression,
        "key3",
        ts.factory.createStringLiteral("new-value")
      );

      astTransformer.updateObjectLiteralMember(ts.isObjectLiteralExpression, {
        name: "key3",
        value: ts.factory.createStringLiteral("newer-value"),
      });

      const result = printer.printFile((astTransformer as any).sourceFile);
      expect(result).toEqual(
        `const myObj = { key1: "hello", key2: "world", key3: "new-value" };\n`
      );
    });

    it("should update an object literal if the target node is dynamically but is part of the AST", () => {
      let updatedSourceFile = astTransformer.addMemberToObjectLiteral(
        ts.isObjectLiteralExpression,
        "key3",
        ts.factory.createStringLiteral("new-value")
      );

      updatedSourceFile = astTransformer.updateObjectLiteralMember(
        ts.isObjectLiteralExpression,
        {
          name: "key3",
          value: ts.factory.createStringLiteral("newer-value"),
        }
      );

      const result = printer.printFile(updatedSourceFile);
      expect(result).toEqual(
        `const myObj = { key1: "hello", key2: "world", key3: "newer-value" };\n`
      );
    });

    it("should create an object literal expression", () => {
      const newObjectLiteral = astTransformer.createObjectLiteralExpression([
        { name: "key3", value: ts.factory.createStringLiteral("new-value") },
      ]);

      const result = printer.printNode(
        ts.EmitHint.Unspecified,
        newObjectLiteral,
        sourceFile
      );
      expect(result).toEqual(`{\n    key3: "new-value"\n}`);
    });
  });

  describe("Array literals", () => {
    beforeEach(() => {
      FILE_CONTENT = `const myArr = [1, 2, 3];`;
      sourceFile = ts.createSourceFile(
        FILE_NAME,
        FILE_CONTENT,
        ts.ScriptTarget.Latest,
        true
      );
      astTransformer = new TypeScriptASTTransformer(sourceFile);
    });

    it("should append element to an array literal", () => {
      const updatedSourceFile = astTransformer.addMembersToArrayLiteral(
        ts.isArrayLiteralExpression,
        [ts.factory.createIdentifier("4")]
      );

      const result = printer.printFile(updatedSourceFile);
      expect(result).toEqual(`const myArr = [1, 2, 3, 4];\n`);
    });

    it("should prepend an element to an array literal", () => {
      const updatedSourceFile = astTransformer.addMembersToArrayLiteral(
        ts.isArrayLiteralExpression,
        [ts.factory.createIdentifier("4")],
        true
      );

      const printer = ts.createPrinter();
      const result = printer.printFile(updatedSourceFile);
      expect(result).toEqual(`const myArr = [4, 1, 2, 3];\n`);
    });

    it("should create an array literal expression with IPropertyAssignment", () => {
      const newArrayLiteral = astTransformer.createArrayLiteralExpression([
        {
          name: "key3",
          value: ts.factory.createStringLiteral("new-value"),
        },
        {
          name: "key4",
          value: ts.factory.createNumericLiteral("5"),
        },
      ]);

      const result = printer.printNode(
        ts.EmitHint.Unspecified,
        newArrayLiteral,
        sourceFile
      );

      expect(result).toEqual(
        `[{\n        key3: "new-value"\n    }, {\n        key4: 5\n    }]`
      );
    });

    it("should create a multilined array literal expression with IPropertyAssignment", () => {
      const newArrayLiteral = astTransformer.createArrayLiteralExpression(
        [
          {
            name: "key3",
            value: ts.factory.createStringLiteral("new-value"),
          },
          {
            name: "key4",
            value: ts.factory.createNumericLiteral("5"),
          },
        ],
        true
      );

      const result = printer.printNode(
        ts.EmitHint.Unspecified,
        newArrayLiteral,
        sourceFile
      );
      expect(result).toEqual(
        `[\n    {\n        key3: "new-value"\n    },\n    {\n        key4: 5\n    }\n]`
      );
    });

    it("should create an array literal expression", () => {
      const newArrayLiteral = astTransformer.createArrayLiteralExpression([
        ts.factory.createStringLiteral("new-value"),
        ts.factory.createNumericLiteral("5"),
      ]);

      const result = printer.printNode(
        ts.EmitHint.Unspecified,
        newArrayLiteral,
        sourceFile
      );
      expect(result).toEqual(`["new-value", 5]`);
    });

    it("should create a multilined array literal expression", () => {
      const newArrayLiteral = astTransformer.createArrayLiteralExpression(
        [
          ts.factory.createStringLiteral("new-value"),
          ts.factory.createNumericLiteral("5"),
        ],
        true
      );

      const result = printer.printNode(
        ts.EmitHint.Unspecified,
        newArrayLiteral,
        sourceFile
      );
      expect(result).toEqual(`[\n    "new-value",\n    5\n]`);
    });
  });

  describe("Imports", () => {
    describe("Creating imports", () => {
      beforeEach(() => {
        FILE_CONTENT = ``;
        sourceFile = ts.createSourceFile(
          FILE_NAME,
          FILE_CONTENT,
          ts.ScriptTarget.Latest,
          true
        );
        astTransformer = new TypeScriptASTTransformer(sourceFile);
      });

      it("should create an import declaration", () => {
        const importDeclaration = astTransformer.createImportDeclaration(
          [{ name: "mock" }],
          "module"
        );

        const result = printer.printNode(
          ts.EmitHint.Unspecified,
          importDeclaration,
          sourceFile
        );
        expect(result).toEqual(`import { mock } from "module";`);
      });

      it("should create an import declaration with an alias", () => {
        const importDeclaration = astTransformer.createImportDeclaration(
          [{ name: "SomeImport", alias: "mock" }],
          "module"
        );

        const result = printer.printNode(
          ts.EmitHint.Unspecified,
          importDeclaration,
          sourceFile
        );
        expect(result).toEqual(`import { SomeImport as mock } from "module";`);
      });

      it("should create a default import declaration", () => {
        const importDeclaration = astTransformer.createImportDeclaration(
          [{ name: "SomeMock" }],
          "module",
          true
        );

        const result = printer.printNode(
          ts.EmitHint.Unspecified,
          importDeclaration,
          sourceFile
        );
        expect(result).toEqual(`import SomeMock from "module";`);
      });

      // TODO: maybe?
      xit("should create an import declaration with a namespace import", () => {
        const importDeclaration = astTransformer.createImportDeclaration(
          [{ name: "*", alias: "mock" }],
          "another-module"
        );

        const result = printer.printNode(
          ts.EmitHint.Unspecified,
          importDeclaration,
          sourceFile
        );
        expect(result).toEqual(`import * as mock from "another-module";`);
      });
    });

    describe("Adding imports", () => {
      beforeEach(() => {
        FILE_CONTENT = `import { mock } from "module";`;
        sourceFile = ts.createSourceFile(
          FILE_NAME,
          FILE_CONTENT,
          ts.ScriptTarget.Latest,
          true
        );
        astTransformer = new TypeScriptASTTransformer(sourceFile);
      });

      it("should add an import declaration", () => {
        const updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "AnotherMock" }],
          "another/module"
        );

        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(
          `import { mock } from "module";\nimport { AnotherMock } from "another/module";\n`
        );
      });

      it("should add an import declaration with an alias", () => {
        const updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "AnotherMock", alias: "anotherMock" }],
          "another/module"
        );

        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(
          `import { mock } from "module";\nimport { AnotherMock as anotherMock } from "another/module";\n`
        );
      });

      it("should add an import declaration as a default import", () => {
        const updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "AnotherMock" }],
          "another/module",
          true
        );

        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(
          `import { mock } from "module";\nimport AnotherMock from "another/module";\n`
        );
      });

      it("should not add an import declaration if its identifier already exists", () => {
        const updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "mock" }],
          "module1"
        );

        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(`import { mock } from "module";\n`);
      });

      it("should not add an import declaration if it already exists", () => {
        const updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "mock" }],
          "module"
        );

        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(`import { mock } from "module";\n`);
      });

      it("should add an import declaration with an existing identifier if it is aliased and is from the same module", () => {
        const updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "mock", alias: "anotherMock" }],
          "module"
        );

        // this is a confusing edge case that results in valid TypeScript as technically no identifier names collide.
        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(`import { mock, mock as anotherMock } from "module";\n`);
      });

      it("should add an import declaration with an existing identifier if it is aliased and is from a different module", () => {
        const updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "mock", alias: "anotherMock" }],
          "another/module"
        );

        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(`import { mock } from "module";\nimport { mock as anotherMock } from "another/module";\n`);
      });

      it("should not add an import declaration if it already exists with the same alias", () => {
        let updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "newMock", alias: "aliasedMock" }],
          "another/module"
        );
        updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "someMock", alias: "aliasedMock" }],
          "yet/another/module"
        );

        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(
          `import { mock } from "module";\nimport { newMock as aliasedMock } from "another/module";\n`
        );
      });

      it("should add identifier to an existing import declaration", () => {
        const updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "AnotherMock" }],
          "module"
        );

        const result = printer.printFile(updatedSourceFile);
        expect(result).toEqual(`import { mock, AnotherMock } from "module";\n`);
      });

      it("should handle multiple import declarations", () => {
        let updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "DefaultAliased", alias: "DA" }], // should drop alias on default import
          "@my/other-module-d",
          true
        );
        updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "SomeAliased", alias: "AS1" }],
          "@my/other-module1"
        );
        updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "ExistingIdentifierAliased", alias: "AS2" }],
          "@my/other-module2"
        );
        updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "ExistingIdentifierAliased", alias: "AS3" }],
          "@my/other-module3"
        );
        updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "ExistingAliasAliased", alias: "AS3" }],
          "@my/other-module3"
        );
        updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "ExistingAliasDiffModule", alias: "AS3" }],
          "@my/other-module31"
        );
        updatedSourceFile = astTransformer.addImportDeclaration(
          [{ name: "ExistingModuleAliased", alias: "AS4" }],
          "@my/other-module2"
        );

        expect(printer.printFile(updatedSourceFile)).toEqual(
          `import { mock } from "module";
import DefaultAliased from "@my/other-module-d";
import { SomeAliased as AS1 } from "@my/other-module1";
import { ExistingIdentifierAliased as AS2, ExistingModuleAliased as AS4 } from "@my/other-module2";
import { ExistingIdentifierAliased as AS3 } from "@my/other-module3";
`
        );
      });
    });
  });
});
