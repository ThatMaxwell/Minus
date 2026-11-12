-- Your phone watching your PC's screen. Frames go over a private Realtime channel named
-- "screen:<your user id>": only you, signed in, can join it, send to it or hear it.
create policy "your own screen channel: listen"
  on realtime.messages for select to authenticated
  using (realtime.topic() = 'screen:' || auth.uid()::text);
create policy "your own screen channel: send"
  on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'screen:' || auth.uid()::text);
