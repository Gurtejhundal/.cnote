#include <iostream>
#include <vector>
using namespace std;

/* @note
# Vector basics

A `vector` is a dynamic array from the C++ STL.

- Indexed access: `O(1)`
- `push_back()`: amortized `O(1)`
- Middle insertion: `O(n)`
*/

int main() {
    vector<int> values = {10, 20, 30};

    /* @warning
    # Size is not the last index

    If `values.size()` is 3, the last valid index is `2`.
    */

    values.push_back(40);

    /* @quiz
    question: After `push_back(40)`, what is the vector size?

    answer: `4`
    */

    for (int value : values) {
        cout << value << ' ';
    }
    cout << '\n';
}
