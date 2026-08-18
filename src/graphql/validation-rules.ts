import { GraphQLError, type ASTVisitor, type ValidationContext } from 'graphql';

/**
 * Query-cost limits for the public graph.
 *
 * The throttler caps how many requests a caller may make; it says nothing about
 * how expensive any one of them is. That matters more here than in a plain
 * GraphQL server: the gateway fans a single client query out across seven
 * subgraphs, so one crafted document can cost far more than one request's worth
 * of work.
 *
 * Two different shapes have to be bounded, and a limit on one does not catch
 * the other:
 *
 *   - **Deep** — nesting cyclic relations (product → seller → products → …).
 *     Bounded by MAX_DEPTH.
 *   - **Wide** — a shallow document repeating the same expensive field under
 *     hundreds of aliases. Depth stays at 2; cost does not. Bounded by
 *     MAX_SELECTIONS.
 */

/**
 * The deepest legitimate client query is the service detail page (service →
 * packages → items → service → seller ≈ 8). 12 leaves headroom for a field
 * or two without admitting a runaway.
 */
export const MAX_DEPTH = 12;

/** Total field selections in one document, across all operations and fragments. */
export const MAX_SELECTIONS = 500;

/**
 * Rejects documents with more than `max` field selections.
 *
 * Counts every Field node in the document rather than walking the executed
 * tree, so aliases each count separately — which is the point, since
 * `a1: expensiveField … a500: expensiveField` is one shallow, narrow-looking
 * query that does 500 times the work.
 */
export function selectionCountLimit(max: number = MAX_SELECTIONS) {
  return (context: ValidationContext): ASTVisitor => {
    let count = 0;
    return {
      Field: {
        enter() {
          count += 1;
          if (count === max + 1) {
            context.reportError(
              new GraphQLError(
                `Query is too large: more than ${max} field selections. ` +
                  `Split it into several smaller queries.`,
              ),
            );
          }
        },
      },
    };
  };
}
