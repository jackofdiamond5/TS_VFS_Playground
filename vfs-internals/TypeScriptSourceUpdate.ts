import ts from "typescript";

export interface IExpressionChange {
  type: "import" | "literal" | "decorator";
  location: { line: number; column: number };
  newValue: any;
}

export interface IImport {
  from: string;
  edit: boolean;
  namedImport?: boolean;
  as?: string;
  component?: string;
  imports?: string[];
}

export interface IPropertyAssignment {
  name: string;
  value: ts.Expression;
}

export class TypeScriptSourceUpdate {
  private readonly changes: IExpressionChange[] = [];

  constructor(private readonly sourceFile: ts.SourceFile) {}

  /**
   * Searches the AST for a variable declaration with the given name and type.
   * @param name The name of the variable to look for.
   * @param type The type of the variable to look for.
   * @returns The variable declaration if found, otherwise `undefined`.
   */
  public findVariableDeclaration(
    name: string,
    type: string
  ): ts.VariableDeclaration | undefined {
    let declaration;
    ts.forEachChild(this.sourceFile, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText() === name &&
        node.type?.getText() === type
      ) {
        declaration = node;
      } else if (ts.isVariableStatement(node)) {
        declaration = node.declarationList.declarations.find(
          (declaration) =>
            declaration.name.getText() === name &&
            declaration.type?.getText() === type
        );
      }
      // handle variable declaration lists (ts.isVariableDeclarationList)?
      // const a = 5, b = 6...;
    });

    return declaration;
  }

  public createObjectLiteralExpression(
    properties: IPropertyAssignment[]
  ): ts.ObjectLiteralExpression {
    const propertyAssignments = properties.map((property) =>
      ts.factory.createPropertyAssignment(property.name, property.value)
    );

    return ts.factory.createObjectLiteralExpression(propertyAssignments, true);
  }

  /**
   * Adds a new property assignment to an object literal expression.
   * @param visitCondition The condition by which the object literal expression is found.
   * @param propertyName The name of the property that will be added.
   * @param propertyValue The value of the property that will be added.
   * @returns 
   */
  public addMemberToObjectLiteral(
    visitCondition: (node: ts.Node) => boolean,
    propertyName: string,
    propertyValue: ts.Expression
  ): ts.SourceFile {
    const newProperty = ts.factory.createPropertyAssignment(
      ts.factory.createIdentifier(propertyName),
      propertyValue
    );

    const transformer: ts.TransformerFactory<ts.Node> = <T extends ts.Node>(
      context: ts.TransformationContext
    ) => {
      return (rootNode: T) => {
        const visitor = (node: ts.Node): ts.VisitResult<ts.Node> => {
          if (ts.isObjectLiteralExpression(node) && visitCondition(node)) {
            return ts.factory.updateObjectLiteralExpression(node, [
              ...node.properties,
              newProperty,
            ]);
          }
          return ts.visitEachChild(node, visitor, context);
        };
        return ts.visitNode(rootNode, visitor);
      };
    };

    return ts.transform(this.sourceFile, [transformer])
      .transformed[0] as ts.SourceFile;
  }

  public addMemberToArrayLiteral(
    arrayLiteral: ts.ArrayLiteralExpression,
    element: ts.Expression
  ) {
    // should append the element at the end of the array literal
    throw new Error("Method not implemented.");
    return arrayLiteral;
  }

  public updateObjectLiteralMember(
    objectLiteral: ts.ObjectLiteralExpression,
    memberName: string,
    value: ts.Expression
  ) {
    // if the member is an array, it should add elements to it via the `addMemberToArrayLiteral`
    // if the member is an object, it should modify it with `addMemberToObjectLiteral`
    throw new Error("Method not implemented.");
  }

  public createArrayLiteral(
    elements: ts.Expression[]
  ): ts.ArrayLiteralExpression {
    throw new Error("Method not implemented.");
  }

  public createObjectLiteral(
    properties: ts.ObjectLiteralElementLike[]
  ): ts.ObjectLiteralExpression {
    throw new Error("Method not implemented.");
  }

  public updateClassDecorator(
    className: string,
    decoratorName: string,
    args: ts.Expression[]
  ) {
    // should update the decorator of a class
    throw new Error("Method not implemented.");
  }

  public createInlineImportStatementArrowFunction(
    importPath: string,
    importName: string,
    parameters: ts.ParameterDeclaration[],
    body: ts.Block
  ) {
    // should create an import statement with an arrow function and add it to the source file
    throw new Error("Method not implemented.");
  }

  // consider simpler params
  public createMemberAccessArrowFunction(
    memberName: string,
    parameters: ts.ParameterDeclaration[],
    body: ts.Block
  ) {
    throw new Error("Method not implemented.");
  }

  public addImportDeclaration(importDeclaration: ts.ImportDeclaration) {
    throw new Error("Method not implemented.");
  }
  // or
  public addImport(importStatement: IImport) {
    // TODO
    // should be able to add aliased imports
    // multiple imports from the same source should be joined into one
  }

  public finalize() {
    // TODO
  }

  private addObjectMember<T, K extends string, V>(
    obj: T,
    key: K,
    value: V
  ): T & { [P in K]: V } {
    return { ...obj, [key]: value } as T & { [P in K]: V };
  }
}
