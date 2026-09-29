#include <vector>
using namespace std;

/* @definition
# Vectors, unlocked
Vectors are **dynamic arrays**.
- `push_back()` adds an element
- `size()` counts the elements
*/

int main() {
    vector<int> scores = {10, 20, 30};
    scores.push_back(40);

    /* @quiz
    question: What is scores.size() now?
    answer: `4`. You're cooking.
    */

    return 0;
}
