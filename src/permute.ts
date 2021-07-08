/**
 * Generates a list of possible mutations from a key value matrix.
 * ```ts
 * permuteMatrix({a: [1, 2, 3], b: [1, 2, 3]});
 * ```
 *
 * @param matrix The `Object.entries` of the matrix
 */
export function permuteMatrix<T>(matrix: Record<string, Iterable<T>>): Iterable<Record<string, T>> {
    return permute(Object.entries(matrix), 0);
}

function* permute<T>(matrix: Array<[string, Iterable<T>]>, offset: number): Iterable<Record<string, T>> {
    if (matrix.length <= offset) {
        yield {};
        return;
    }

    const [key, values] = matrix[offset];
    for (const value of values) {
        for (const mutation of permute(matrix, offset + 1)) {
            mutation[key] = value;
            yield mutation;
        }
    }
}
