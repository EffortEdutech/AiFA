-- Sprint 65 -- Domain Binding: scheduled re-check (Sprint_Plan.md's own
-- Sprint 65 scope item, alongside the "Check now" button).
--
-- Calls the verify-domain edge function (batch mode) every 15 minutes so a
-- domain flips to verified on its own once the owner adds the DNS TXT
-- record, without requiring them to click "Check now". The Authorization
-- header carries this project's own PUBLIC anon key -- not a secret, safe
-- to store in a migration -- which the function treats as a system/cron
-- caller (role: "anon") rather than a real visitor; see verify-domain's own
-- header comment. The actual service-role write access lives only inside
-- the edge function's platform-injected environment, never here.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'sprint65-domain-verify-recheck',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://yotapuotkbyyocraraza.supabase.co/functions/v1/verify-domain',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdGFwdW90a2J5eW9jcmFyYXphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NDUxOTksImV4cCI6MjEwNDMyMTE5OX0.xhjXRg9QAGrx7bAEM1fmuNrOYz3JA7i_tlwMOIa10iU',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
