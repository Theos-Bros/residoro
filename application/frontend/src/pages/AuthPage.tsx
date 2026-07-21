import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

type Profile = {
  id: string;
  tenant_id: string | null;
  role: string;
  full_name: string | null;
};

export function AuthPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-up');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    // Proves Auth + the handle_new_user trigger + RLS all work together:
    // a signed-in user can read exactly their own profiles row, populated
    // automatically on signup.
    supabase
      .from('profiles')
      .select('id, tenant_id, role, full_name')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setMessage(`Could not load profile: ${error.message}`);
          return;
        }
        setProfile(data);
      });
  }, [session]);

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  if (session) {
    return (
      <div>
        <h1>Signed in</h1>
        <p>User: {session.user.email}</p>
        {profile ? (
          <ul>
            <li>Profile ID: {profile.id}</li>
            <li>Workspace (tenant_id): {profile.tenant_id}</li>
            <li>Role: {profile.role}</li>
          </ul>
        ) : (
          <p>{message ?? 'Loading profile…'}</p>
        )}
        <button onClick={handleSignOut}>Sign out</button>
      </div>
    );
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
