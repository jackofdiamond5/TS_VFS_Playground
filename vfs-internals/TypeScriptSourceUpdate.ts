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
  private _printer: ts.Printer | undefined;

  constructor(
    private sourceFile: ts.SourceFile,
    private readonly printerOptions?: ts.PrinterOptions
  ) {}

  /**
   * The printer instance to use to print the source file after modifications.
   */
  public get printer(): ts.Printer {
    if (!this._printer) {
      this._printer = ts.createPrinter(this.printerOptions);
    }

    return this._printer;
  }

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

  /**
   * Adds a new property assignment to an object literal expression.
   * @param visitCondition The condition by which the object literal expression is found.
   * @param propertyName The name of the property that will be added.
   * @param propertyValue The value of the property that will be added.
   * @returns The mutated AST.
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

    return (this.sourceFile = ts.transform(this.sourceFile, [transformer])
      .transformed[0] as ts.SourceFile);
  }

  /**
   * Appends a new element at the end of a given array literal expression.
   * @param visitCondition The condition by which the array literal expression is found.
   * @param elements The elements that will be added to the array literal.
   * @returns The mutated AST.
   */
  public addMembersToArrayLiteral(
    visitCondition: (node: ts.Node) => boolean,
    elements: ts.Expression[]
  ): ts.SourceFile {
    const transformer: ts.TransformerFactory<ts.Node> = <T extends ts.Node>(
      context: ts.TransformationContext
    ) => {
      return (rootNode: T) => {
        const visitor = (node: ts.Node): ts.VisitResult<ts.Node> => {
          if (ts.isArrayLiteralExpression(node) && visitCondition(node)) {
            return ts.factory.updateArrayLiteralExpression(node, [
              ...node.elements,
              ...elements,
            ]);
          }
          return ts.visitEachChild(node, visitor, context);
        };
        return ts.visitNode(rootNode, visitor);
      };
    };

    return (this.sourceFile = ts.transform(this.sourceFile, [transformer])
      .transformed[0] as ts.SourceFile);
  }

  /**
   * Update the value of a member in an object literal expression.
   * @param visitCondition The condition by which the object literal expression is found.
   * @param targetMember The member that will be updated. The value should be new value to set.
   * @returns The mutated AST.
   * @remarks This method will not update nodes that were inserted through the compiler API.
   * And the `visitCondition` should ignore nodes that have `pos` & `end` less than 0.
   */
  public updateObjectLiteralMember(
    visitCondition: (node: ts.Node) => boolean,
    targetMember: IPropertyAssignment
  ): ts.SourceFile {
    const transformer: ts.TransformerFactory<ts.Node> = <T extends ts.Node>(
      context: ts.TransformationContext
    ) => {
      return (rootNode: T) => {
        const visitor = (node: ts.Node): ts.VisitResult<ts.Node> => {
          if (ts.isObjectLiteralExpression(node) && visitCondition(node)) {
            const newProperties = node.properties.map((property) => {
              const isPropertyAssignment = ts.isPropertyAssignment(property);
              if (
                isPropertyAssignment &&
                (property.pos < 0 || property.end < 0)
              ) {
                // nodes inserted through the compiler API will have pos & end < 0
                // we cannot update them until the source file is read anew and the nodes are re-created
                // since pos & end are set during initial parsing and are readonly
                return property;
              }
              if (
                isPropertyAssignment &&
                property.name.getText() === targetMember.name
              ) {
                return ts.factory.updatePropertyAssignment(
                  property,
                  property.name,
                  targetMember.value
                );
              }
              return property;
            });

            return ts.factory.updateObjectLiteralExpression(
              node,
              newProperties
            );
          }
          return ts.visitEachChild(node, visitor, context);
        };
        return ts.visitNode(rootNode, visitor);
      };
    };

    return (this.sourceFile = ts.transform(this.sourceFile, [transformer])
      .transformed[0] as ts.SourceFile);
  }

  /**
   * Creates a new object literal expression with the given properties.
   * @param properties The properties to add to the object literal.
   */
  public createObjectLiteralExpression(
    properties: IPropertyAssignment[]
  ): ts.ObjectLiteralExpression {
    const propertyAssignments = properties.map((property) =>
      ts.factory.createPropertyAssignment(property.name, property.value)
    );

    return ts.factory.createObjectLiteralExpression(propertyAssignments, true);
  }

  /**
   * Create an array literal expression with the given elements.
   * @param elements The elements to include in the array literal.
   * @param multiline Whether the array literal should be multiline.
   */
  public createArrayLiteralExpression(
    elements: ts.Expression[],
    multiline?: boolean
  ): ts.ArrayLiteralExpression;
  public createArrayLiteralExpression(
    elements: IPropertyAssignment[],
    multiline?: boolean
  ): ts.ArrayLiteralExpression;
  public createArrayLiteralExpression(
    elementsOrProperties: ts.Expression[] | IPropertyAssignment[],
    multiline = false
  ): ts.ArrayLiteralExpression {
    if (
      elementsOrProperties.every((element) =>
        ts.isExpression(element as ts.Node)
      )
    ) {
      return ts.factory.createArrayLiteralExpression(
        elementsOrProperties as ts.Expression[],
        multiline
      );
    }

    const propertyAssignments = (
      elementsOrProperties as IPropertyAssignment[]
    ).map((property) => this.createObjectLiteralExpression([property]));
    return ts.factory.createArrayLiteralExpression(
      propertyAssignments,
      multiline
    );
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
    // apply formatting to the source file
    // with the printer get the string representation of the source file
  }

  private addObjectMember<T, K extends string, V>(
    obj: T,
    key: K,
    value: V
  ): T & { [P in K]: V } {
    return { ...obj, [key]: value } as T & { [P in K]: V };
  }
}
