import Mathlib

theorem mathlib_pending (n m : Nat) : n + m = m + n := by
  have h1 : n + m = n + m := by
    rfl
  have h2 : m = m := by
    rfl
