"""Linear Programming utilities."""

from scipy import sparse


def variable(
    name: str, size: int, variables: dict[str, int] = {}
) -> sparse.sparray:
    """Create a new variable in the program.

    Args:
        name: Must be unique
        size: Vector length

    Returns:
        A sparse array representing the variable.
    """
    if name in variables:
        raise ValueError(name + " already created.")
    index = sum(variables.values(), 0)
    variables[name] = size
    return sparse.eye_array(m=size, n=index + size, k=index, format="csr")


def resize(*args: sparse.sparray) -> None:
    """Resize sparse matrices to the fit the widest.

    Linear variables get progressively wider so we fill
    older (thus narrower) ones with zeros on the right,
    which is precisely what :external+scipy:meth:`scipy.sparse.csr_matrix.`
    does
    """
    n = max(arg.shape[1] for arg in args)
    for arg in args:
        arg.resize((arg.shape[0], n))
