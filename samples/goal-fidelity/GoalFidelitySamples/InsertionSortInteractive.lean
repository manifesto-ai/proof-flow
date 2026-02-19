def insertSorted (x : Nat) : List Nat → List Nat
  | [] => [x]
  | y :: ys =>
    if x ≤ y then x :: y :: ys
    else y :: insertSorted x ys

def insertionSort : List Nat → List Nat
  | [] => []
  | x :: xs => insertSorted x (insertionSort xs)

theorem insertionSort_length (xs : List Nat) :
    (insertionSort xs).length = xs.length := by
  induction xs with
  | nil => simp [insertionSort]
  | cons x xs ih =>
    simp [insertionSort, ih]

theorem insertionSort_length_interactive (xs : List Nat) :
    (insertionSort xs).length = xs.length := by
  sorry
