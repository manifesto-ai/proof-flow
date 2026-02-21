import Mathlib

def collatzStep (n : Nat) : Nat :=
  if n % 2 = 0 then n / 2 else 3 * n + 1

theorem collatzStep_eq (n : Nat) : collatzStep n = if n % 2 = 0 then n / 2 else 3 * n + 1 := by
  rfl

theorem collatzStep_nonzero (n : Nat) (hn : n ≠ 0) : collatzStep n ≠ 0 := by
  simp [collatzStep, hn]

theorem collatzStep_at_least_one (n : Nat) : 1 ≤ collatzStep (n + 1) := by
  sorry
