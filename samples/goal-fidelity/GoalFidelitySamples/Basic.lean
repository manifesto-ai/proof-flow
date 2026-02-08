theorem basic_eq (n : Nat) : n + 0 = n := by
  simp

theorem basic_pending (n m : Nat) : n + m = m + n := by
  have h : n = n := by
    rfl
