import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-up');
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const { error } =
      mode === 'sign-up'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage(error.message);
    }
  }

  return (
    <div>
      <h1>{mode === 'sign-up' ? 'Sign up' : 'Sign in'}</h1>
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
        <button type="submit">{mode === 'sign-up' ? 'Sign up' : 'Sign in'}</button>
      </form>
      <button onClick={() => setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')}>
        Switch to {mode === 'sign-up' ? 'sign in' : 'sign up'}
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
