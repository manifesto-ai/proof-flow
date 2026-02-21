import Mathlib

def insertSorted (x : Nat) : List Nat → List Nat
  | [] => [x]
  | y :: ys =>
    if x ≤ y then x :: y :: ys
    else y :: insertSorted x ys

def insertionSort : List Nat → List Nat
  | [] => []
  | x :: xs => insertSorted x (insertionSort xs)

-- insertSorted가 길이를 1 증가시킴
theorem insertSorted_length (x : Nat) (xs : List Nat) :
    (insertSorted x xs).length = xs.length + 1 := by
  induction xs with
  | nil => simp [insertSorted]
  | cons y ys ih =>
    simp [insertSorted]
    split
    · simp
    · simp [ih]

-- insertionSort가 길이를 보존함
theorem insertionSort_length (xs : List Nat) :
    (insertionSort xs).length = xs.length := by
  induction xs with
  | nil => simp [insertionSort]
  | cons x xs ih =>
    simp [insertionSort, insertSorted_length, ih]

theorem insertionSort_length_pending (xs : List Nat) :
    (insertionSort xs).length = xs.length := by
  sorry
