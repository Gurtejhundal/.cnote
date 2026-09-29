# @note
# # Python lists
#
# Lists are mutable sequences.
# - Indexing is usually `O(1)`
# - Appending is amortized `O(1)`
# @end

numbers = [10, 20, 30]
numbers.append(40)

# @quiz
# question: What does `append(40)` change?
#
# answer: It adds `40` to the end of the list.
# @end

print(numbers)
