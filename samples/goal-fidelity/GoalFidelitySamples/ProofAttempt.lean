theorem proofAttempt (n : Nat) : n + 0 = n := by
  induction n with
  | zero => simp
  | succ n ih => simpa [Nat.succ_add, Nat.add_succ] using congrArg (fun x => x + 1) ih
