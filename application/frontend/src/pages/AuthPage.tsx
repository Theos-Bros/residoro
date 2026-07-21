import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Sign-in only -- there is no public signup anywhere in Residoro (see
// cap-client-lifecycle-001 / tb-client-lifecycle-operator-access-001).
// Accounts are created exclusively via invite: operators through
// application/backend/src/scripts/create-operator.ts, brokerage clients
// through an admin-driven invite once tb-client-lifecycle-enrollment-001
// exists. Shared by both operators and brokerage users -- the app checks
// role after sign-in (see useOperatorStatus) and routes accordingly.
export function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage(error.message);
    }
  }

  return (
    <div>
      <h1>Sign in</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        <button type="submit">Sign in</button>
      </form>
      {message && <p>{message}</p>}
    </div>
  );
}
