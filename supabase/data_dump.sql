-- DATA_LOAD_WRAPPER_ADDED
begin;
set session_replication_role = replica;

SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict K7ZSBdUyLa9elbK2N7UmKw8yF1ONtJVjIhQ2bkaXAJ4loxIT0ayOOMK0olSAvXU

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."audit_log_entries" ("instance_id", "id", "payload", "created_at", "ip_address") VALUES
	('00000000-0000-0000-0000-000000000000', 'cbcfe5b8-2248-4fb1-9c99-d3aed5f87521', '{"action":"user_signedup","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"team","traits":{"provider":"email"}}', '2026-09-03 14:59:28.948624+00', ''),
	('00000000-0000-0000-0000-000000000000', '78e04457-9f63-4714-81ab-4df175894026', '{"action":"login","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2026-09-03 14:59:28.964842+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f3c7f37f-59f7-44f2-84ed-7bdb3e7bad7d', '{"action":"user_recovery_requested","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"user"}', '2026-09-03 14:59:29.028612+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c49a86bf-f217-4dc3-8069-328592939c71', '{"action":"login","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"account"}', '2026-09-03 14:59:42.536448+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ee486033-ef8d-4a79-b63f-5633a1911634', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 17:28:48.172948+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e00fc664-87c2-4770-8019-35ca4cd46459', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 17:28:48.176615+00', ''),
	('00000000-0000-0000-0000-000000000000', '301d7c00-a773-4cf9-b199-9d296c98e511', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 18:27:48.064368+00', ''),
	('00000000-0000-0000-0000-000000000000', 'dad7f17b-251e-4b18-bbe2-3551268d7e7f', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 18:27:48.066265+00', ''),
	('00000000-0000-0000-0000-000000000000', '92223ca7-843a-47ec-8e98-48671837acb5', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 19:26:47.943854+00', ''),
	('00000000-0000-0000-0000-000000000000', '6c293c97-5150-4b4e-8c38-f914e9f4b088', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 19:26:47.945359+00', ''),
	('00000000-0000-0000-0000-000000000000', '3c2f1aa1-08b5-4b3c-ac45-130a31db7cc8', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 20:25:47.833069+00', ''),
	('00000000-0000-0000-0000-000000000000', '008495f4-63c1-4881-8429-48e4538a526a', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 20:25:47.834101+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ec154e96-3baa-4067-9b8d-10a1d459fd7f', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 21:24:14.181112+00', ''),
	('00000000-0000-0000-0000-000000000000', '6a3cf6f5-d37b-4abc-aabe-ae52fb352cf4', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 21:24:14.182089+00', ''),
	('00000000-0000-0000-0000-000000000000', '11c92f3b-f039-4421-a355-1dbc3706aa1c', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 22:22:24.442011+00', ''),
	('00000000-0000-0000-0000-000000000000', '76c76cf7-ad68-4dcf-90bb-6e47814f5cfa', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 22:22:24.44295+00', ''),
	('00000000-0000-0000-0000-000000000000', 'eb9159b6-cd59-488d-b2e7-d7f22f28c397', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 23:22:15.70772+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e8f58dad-93d6-423c-8f8e-251102962d10', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-03 23:22:15.70973+00', ''),
	('00000000-0000-0000-0000-000000000000', '1fee8e57-817b-4d75-951c-f33adbeef5a1', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 00:20:22.352038+00', ''),
	('00000000-0000-0000-0000-000000000000', '38dba91e-6a0d-4376-a975-523d935faa98', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 00:20:22.353693+00', ''),
	('00000000-0000-0000-0000-000000000000', '2739291b-e3e8-4454-ad7e-81fc8d38ed13', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 01:18:22.235978+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e671301b-0d13-4f54-b36d-3d408bf5eb6f', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 01:18:22.236979+00', ''),
	('00000000-0000-0000-0000-000000000000', '39377b20-e2c8-4f24-afd3-daf2d80fc381', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 02:24:47.537763+00', ''),
	('00000000-0000-0000-0000-000000000000', '00982919-5752-4d96-8a56-40d7613b2d85', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 02:24:47.539055+00', ''),
	('00000000-0000-0000-0000-000000000000', '24263e5c-13c5-411a-b44d-12ab06efc8e7', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 03:23:47.249058+00', ''),
	('00000000-0000-0000-0000-000000000000', '3aad27d2-2a2d-4920-8857-09e9d510602e', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 03:23:47.252107+00', ''),
	('00000000-0000-0000-0000-000000000000', '1917dcbe-9fc9-434d-8dfa-63e0b3e45bf1', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 04:21:56.218908+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c5713fe9-c642-4a96-9c22-218cf312054c', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 04:21:56.221591+00', ''),
	('00000000-0000-0000-0000-000000000000', '016ee38d-b057-4d21-9d02-e284046b5689', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 06:30:15.570388+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f6946a2b-a65a-4430-9bc0-2783b219488f', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 06:30:15.572622+00', ''),
	('00000000-0000-0000-0000-000000000000', '97986adf-c1ef-451d-911d-687508898ffe', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 07:32:12.982961+00', ''),
	('00000000-0000-0000-0000-000000000000', '9edfcc0c-e55f-473e-a936-f207c8636616', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 07:32:12.985987+00', ''),
	('00000000-0000-0000-0000-000000000000', '32807ab4-4363-4ab6-828b-3781da8bef21', '{"action":"logout","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"account"}', '2026-09-04 07:49:43.384339+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b5e1022d-42f6-46a3-97fb-d72ed35ffcc9', '{"action":"user_recovery_requested","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"user"}', '2026-09-04 07:55:25.230261+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd807c56b-83eb-4cbf-9965-58c57e8cb1a1', '{"action":"login","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"account"}', '2026-09-04 07:55:45.540994+00', ''),
	('00000000-0000-0000-0000-000000000000', 'fad1210b-cba5-4d99-bd40-64c31e4f6527', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 09:16:41.515786+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e4926142-7703-4d65-9f30-9dd6d6029ac9', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 09:16:41.518657+00', ''),
	('00000000-0000-0000-0000-000000000000', '9bf4a799-8a52-49b1-b4f4-c92aef7984f6', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 10:14:41.188431+00', ''),
	('00000000-0000-0000-0000-000000000000', '84ad2db2-3a3b-4258-8dc6-b6942efd9cc0', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 10:14:41.190974+00', ''),
	('00000000-0000-0000-0000-000000000000', '3a45cf52-ef21-4548-b3c5-ec9f5bf04ce0', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 11:14:37.544795+00', ''),
	('00000000-0000-0000-0000-000000000000', '8bb0a99a-50c5-4814-8379-bbd6cf10b34a', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 11:14:37.546984+00', ''),
	('00000000-0000-0000-0000-000000000000', '4b9d8942-be9a-4579-abf6-2740ac81489b', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 12:16:31.421978+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b93787ed-bd8a-4a7c-beec-acc540f0fcd7', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 12:16:31.629851+00', ''),
	('00000000-0000-0000-0000-000000000000', '02c7e221-01bd-4b43-920f-03c7435150f5', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 13:14:48.480103+00', ''),
	('00000000-0000-0000-0000-000000000000', '040e6816-2b5a-47ca-aeeb-4c5d8a34c0ce', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 13:14:48.481141+00', ''),
	('00000000-0000-0000-0000-000000000000', '3ef49cc7-f38b-4d77-8f16-0bd7a8f39ef1', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 15:14:24.644101+00', ''),
	('00000000-0000-0000-0000-000000000000', '3161f4d6-3977-4d8e-a3f0-0f0ab00a9d25', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 15:14:24.649933+00', ''),
	('00000000-0000-0000-0000-000000000000', '060e6fd3-a76a-415f-b6b9-b80fd7e723b3', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 18:02:23.036621+00', ''),
	('00000000-0000-0000-0000-000000000000', '2bfd23fc-9ea3-469e-9acc-edb68cde597b', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 18:02:23.039453+00', ''),
	('00000000-0000-0000-0000-000000000000', '74aa82bc-3022-4474-aa9f-c92152f41695', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 19:01:40.081398+00', ''),
	('00000000-0000-0000-0000-000000000000', '83fa93d1-f3e8-4f50-b375-f055a67dc07d', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 19:01:40.082827+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a926a60d-094c-4bb5-a22c-bbac6238ac23', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 20:07:09.856563+00', ''),
	('00000000-0000-0000-0000-000000000000', '7a7a848c-28b6-4fd4-9495-686e2a1702e6', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 20:07:09.858239+00', ''),
	('00000000-0000-0000-0000-000000000000', '36eb3a63-8f04-4140-b27b-10c24b14dc73', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 21:06:39.815537+00', ''),
	('00000000-0000-0000-0000-000000000000', '6ae13835-278c-4ddb-930f-ed2844106fe9', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 21:06:39.816704+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b0caa27b-f93e-4a4b-aff1-1197442972e0', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 22:05:39.767858+00', ''),
	('00000000-0000-0000-0000-000000000000', '74b327a1-eca8-4a21-8c83-73d21ed4bbcd', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 22:05:39.769692+00', ''),
	('00000000-0000-0000-0000-000000000000', '6bac9623-fea6-4cac-ad08-185887e97bc0', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 23:04:39.583108+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c0c40f3e-412a-4237-8a6d-a7b8e6934296', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-04 23:04:39.584151+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e5c7d6d3-33f7-410b-a3f1-dfb7fd9e6eb5', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 03:02:36.884563+00', ''),
	('00000000-0000-0000-0000-000000000000', '96ad1eee-ba4d-4023-9f1b-cff52ce19bbd', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 03:02:36.887997+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bc15b801-a06f-49b9-9e5a-aa323b2fcb2d', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 04:01:22.221588+00', ''),
	('00000000-0000-0000-0000-000000000000', '78842933-3e50-4aa5-b869-b0e8a355dd8e', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 04:01:22.225472+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd2796d0e-3eb9-4f3f-86f3-ce47cac68f62', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 05:17:33.555957+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e61bd326-7dc9-42bf-84cb-af7760a8ed8c', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 05:17:33.558701+00', ''),
	('00000000-0000-0000-0000-000000000000', '61ce059f-d539-44d9-b878-358db6ddcde5', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 06:16:33.492013+00', ''),
	('00000000-0000-0000-0000-000000000000', 'ad6e0093-f406-4124-9abd-4f0ddfb2e3d4', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 06:16:33.493267+00', ''),
	('00000000-0000-0000-0000-000000000000', '28a5da82-af23-45ea-b090-483cc83a21e5', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 07:14:48.693215+00', ''),
	('00000000-0000-0000-0000-000000000000', '604c44b2-576d-4f69-9ca5-651eaec0cd48', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 07:14:48.694577+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c133686e-1daa-4feb-a933-2368cc2a3d33', '{"action":"logout","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"account"}', '2026-09-05 07:14:59.353096+00', ''),
	('00000000-0000-0000-0000-000000000000', '0b3d9b52-6629-4e64-9832-4c289db79e06', '{"action":"user_signedup","actor_id":"5d741fe0-09ed-4a90-aa65-af905bd13ef1","actor_username":"artangkut@test.mail","actor_via_sso":false,"log_type":"team","traits":{"provider":"email"}}', '2026-09-05 07:15:24.397739+00', ''),
	('00000000-0000-0000-0000-000000000000', 'e35db827-c225-477c-8b48-b47679d9ec6c', '{"action":"login","actor_id":"5d741fe0-09ed-4a90-aa65-af905bd13ef1","actor_username":"artangkut@test.mail","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}', '2026-09-05 07:15:24.419437+00', ''),
	('00000000-0000-0000-0000-000000000000', '5df1cc9a-d891-46bb-890f-20e1d6d51dae', '{"action":"user_recovery_requested","actor_id":"5d741fe0-09ed-4a90-aa65-af905bd13ef1","actor_username":"artangkut@test.mail","actor_via_sso":false,"log_type":"user"}', '2026-09-05 07:15:24.482459+00', ''),
	('00000000-0000-0000-0000-000000000000', '5a45fa04-70a2-4eff-89d8-40169cf0211b', '{"action":"login","actor_id":"5d741fe0-09ed-4a90-aa65-af905bd13ef1","actor_username":"artangkut@test.mail","actor_via_sso":false,"log_type":"account"}', '2026-09-05 07:15:38.290562+00', ''),
	('00000000-0000-0000-0000-000000000000', '2d4bbe47-56f8-4616-9df7-de72aedc13ee', '{"action":"token_refreshed","actor_id":"5d741fe0-09ed-4a90-aa65-af905bd13ef1","actor_username":"artangkut@test.mail","actor_via_sso":false,"log_type":"token"}', '2026-09-05 09:12:10.155561+00', ''),
	('00000000-0000-0000-0000-000000000000', '8acd2806-482f-4fe1-b078-e626893f76d3', '{"action":"token_revoked","actor_id":"5d741fe0-09ed-4a90-aa65-af905bd13ef1","actor_username":"artangkut@test.mail","actor_via_sso":false,"log_type":"token"}', '2026-09-05 09:12:10.160101+00', ''),
	('00000000-0000-0000-0000-000000000000', '92e3b5ef-bb43-4bd3-9add-86570c62cd7b', '{"action":"logout","actor_id":"5d741fe0-09ed-4a90-aa65-af905bd13ef1","actor_username":"artangkut@test.mail","actor_via_sso":false,"log_type":"account"}', '2026-09-05 09:55:51.402142+00', ''),
	('00000000-0000-0000-0000-000000000000', '43c7257e-e95c-4b4c-beea-7dc7573b23e0', '{"action":"user_recovery_requested","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"user"}', '2026-09-05 09:56:02.285771+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b81a00c6-4ec1-4784-afeb-47d0f5c4e68c', '{"action":"login","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"account"}', '2026-09-05 09:56:13.944791+00', ''),
	('00000000-0000-0000-0000-000000000000', '84037694-996b-462b-ae55-615d7e1ee5db', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 15:00:31.667527+00', ''),
	('00000000-0000-0000-0000-000000000000', '5edd571b-d638-4aac-8b2b-4c62a6b02e7d', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-05 15:00:31.674761+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd55b525c-bf00-4429-a949-60aaf503076a', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 00:50:30.421664+00', ''),
	('00000000-0000-0000-0000-000000000000', '25d8cc86-28dd-4ec9-af54-4bf4bf53bd2c', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 00:50:30.427474+00', ''),
	('00000000-0000-0000-0000-000000000000', '50b53bea-2b49-4174-9e0d-e0871780b9fa', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 02:15:28.217364+00', ''),
	('00000000-0000-0000-0000-000000000000', '80209926-7122-41cd-805e-eae09a1b541d', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 02:15:28.219552+00', ''),
	('00000000-0000-0000-0000-000000000000', '5acf40e0-219e-4a54-8234-36e101ad3411', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 03:22:41.132604+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bd8ff739-04a1-4661-99eb-f8125ec612e5', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 03:22:41.144543+00', ''),
	('00000000-0000-0000-0000-000000000000', 'b2ff8d7b-82b0-4bea-a145-d17837cd2f5a', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 04:21:06.962754+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a756f5e0-66e1-4afe-8387-08baca4c25c2', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 04:21:06.964316+00', ''),
	('00000000-0000-0000-0000-000000000000', '5e54b82f-600c-4edf-8140-23c9838ba546', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 05:19:25.149273+00', ''),
	('00000000-0000-0000-0000-000000000000', '24fcd7df-541c-4f41-8c28-a35b25b8baeb', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 05:19:25.151204+00', ''),
	('00000000-0000-0000-0000-000000000000', '5dc66abb-6fdb-46da-8ff0-985e6e3eb3a4', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 06:18:02.108991+00', ''),
	('00000000-0000-0000-0000-000000000000', '88f9ef47-1182-4344-a098-8f855bfb4d1b', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 06:18:02.110198+00', ''),
	('00000000-0000-0000-0000-000000000000', '463390c9-1627-4320-971f-8ab7800c5697', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 08:16:56.349094+00', ''),
	('00000000-0000-0000-0000-000000000000', '760cb299-6355-4009-91de-80d2762727e2', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 08:16:56.352507+00', ''),
	('00000000-0000-0000-0000-000000000000', '3357ae22-8749-4731-bd44-11fd05a5ec64', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 09:26:40.27893+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd10a6644-1112-48db-91f0-3ffaab394c2f', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 09:26:40.287476+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c5698204-7c5b-4ce9-b1f9-45ea78209a2a', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 10:30:38.479487+00', ''),
	('00000000-0000-0000-0000-000000000000', 'c97cc63f-6c9a-43df-b769-7d118165b49f', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 10:30:38.48551+00', ''),
	('00000000-0000-0000-0000-000000000000', 'bdaa2c04-13fd-40ad-915a-660878ae3d24', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 11:58:15.083163+00', ''),
	('00000000-0000-0000-0000-000000000000', '2ef4da0d-1bc3-40d5-a10c-d69bf33e3d68', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 11:58:15.08679+00', ''),
	('00000000-0000-0000-0000-000000000000', 'a3ea0c02-787a-49a2-ad78-2bc8c28d03af', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 12:56:54.575644+00', ''),
	('00000000-0000-0000-0000-000000000000', '27e0a99e-8ed1-467f-9592-33f387684eff', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 12:56:54.596122+00', ''),
	('00000000-0000-0000-0000-000000000000', '8d56050c-43ed-49dd-9ce0-690696a6f611', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 13:55:38.287624+00', ''),
	('00000000-0000-0000-0000-000000000000', 'dd504036-f1b3-466a-a490-ba1f11abb87a', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 13:55:38.289187+00', ''),
	('00000000-0000-0000-0000-000000000000', '1c297829-aef0-4652-8af7-03ce573ec62a', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 15:18:44.354381+00', ''),
	('00000000-0000-0000-0000-000000000000', 'f8e132ae-d9aa-4176-a609-0fa5ad0a4e3e', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-06 15:18:44.357228+00', ''),
	('00000000-0000-0000-0000-000000000000', '47eb7715-14b6-49de-942a-ef4c0ce7f4d9', '{"action":"token_refreshed","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-07 02:57:17.913763+00', ''),
	('00000000-0000-0000-0000-000000000000', 'd6c3ff8f-2eb9-44e9-adf3-ae395b3e6c73', '{"action":"token_revoked","actor_id":"a69b59de-e9c7-4da1-9b17-6c2f4d08de4f","actor_username":"nhl.global.solution@gmail.com","actor_via_sso":false,"log_type":"token"}', '2026-09-07 02:57:17.919186+00', '');


--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") VALUES
	('00000000-0000-0000-0000-000000000000', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'authenticated', 'authenticated', 'nhl.global.solution@gmail.com', '$2a$10$ZIoL6OyDW/ebUOCVOot1P.anEZJ5Za1u6a6J6K8MQhh7Q748xMu4a', '2026-09-03 14:59:28.949796+00', NULL, '', NULL, '', '2026-09-05 09:56:02.290327+00', '', '', NULL, '2026-09-05 09:56:13.948392+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "a69b59de-e9c7-4da1-9b17-6c2f4d08de4f", "email": "nhl.global.solution@gmail.com", "email_verified": true, "phone_verified": false}', NULL, '2026-09-03 14:59:28.93496+00', '2026-09-07 02:57:17.925709+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', 'authenticated', 'authenticated', 'artangkut@test.mail', '$2a$10$FGlVbiGg/tsgQpHowN0pi./b4fBdQJtwCDF19UVYzXvIlMSHPyTKG', '2026-09-05 07:15:24.399307+00', NULL, '', NULL, '', '2026-09-05 07:15:24.484823+00', '', '', NULL, '2026-09-05 07:15:38.294121+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "5d741fe0-09ed-4a90-aa65-af905bd13ef1", "email": "artangkut@test.mail", "email_verified": true, "phone_verified": false}', NULL, '2026-09-05 07:15:24.368265+00', '2026-09-05 09:12:10.170205+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false);


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
	('a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '{"sub": "a69b59de-e9c7-4da1-9b17-6c2f4d08de4f", "email": "nhl.global.solution@gmail.com", "email_verified": false, "phone_verified": false}', 'email', '2026-09-03 14:59:28.944472+00', '2026-09-03 14:59:28.944531+00', '2026-09-03 14:59:28.944531+00', 'ee3d9300-2e9b-409a-aa56-cb17c42c29e8'),
	('5d741fe0-09ed-4a90-aa65-af905bd13ef1', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '{"sub": "5d741fe0-09ed-4a90-aa65-af905bd13ef1", "email": "artangkut@test.mail", "email_verified": false, "phone_verified": false}', 'email', '2026-09-05 07:15:24.39062+00', '2026-09-05 07:15:24.390693+00', '2026-09-05 07:15:24.390693+00', '4982da91-ec7f-4761-8f4f-25063d63da46');


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id", "refresh_token_hmac_key", "refresh_token_counter", "scopes") VALUES
	('b7a10269-e79c-4ae5-8529-6b1569834014', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '2026-09-05 09:56:13.94852+00', '2026-09-07 02:57:17.934629+00', NULL, 'aal1', NULL, '2026-09-07 02:57:17.934499', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', '172.28.0.1', NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") VALUES
	('b7a10269-e79c-4ae5-8529-6b1569834014', '2026-09-05 09:56:13.952973+00', '2026-09-05 09:56:13.952973+00', 'otp', 'ac414622-a66e-4321-bf1f-f98b126fe511');


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") VALUES
	('00000000-0000-0000-0000-000000000000', 38, 'unsoatvjgrq3', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-05 09:56:13.950605+00', '2026-09-05 15:00:31.67648+00', NULL, 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 39, '4263wsn7avmw', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-05 15:00:31.679747+00', '2026-09-06 00:50:30.428402+00', 'unsoatvjgrq3', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 40, 'uhqp3iffylkq', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 00:50:30.434065+00', '2026-09-06 02:15:28.22081+00', '4263wsn7avmw', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 41, 'pzqm5dpopk3j', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 02:15:28.222392+00', '2026-09-06 03:22:41.149019+00', 'uhqp3iffylkq', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 42, 'dvsmeaahiyu5', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 03:22:41.153826+00', '2026-09-06 04:21:06.965198+00', 'pzqm5dpopk3j', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 43, 'vw7lmwk2umwl', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 04:21:06.9663+00', '2026-09-06 05:19:25.151822+00', 'dvsmeaahiyu5', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 44, '43pieg22wt7y', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 05:19:25.153055+00', '2026-09-06 06:18:02.111163+00', 'vw7lmwk2umwl', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 45, 'oif264enw7ai', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 06:18:02.112603+00', '2026-09-06 08:16:56.354176+00', '43pieg22wt7y', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 46, 'ui4uz6m77tlb', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 08:16:56.357244+00', '2026-09-06 09:26:40.291966+00', 'oif264enw7ai', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 47, 's3twlftlljty', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 09:26:40.303842+00', '2026-09-06 10:30:38.486639+00', 'ui4uz6m77tlb', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 48, 'clvwk5dwoia3', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 10:30:38.492643+00', '2026-09-06 11:58:15.088178+00', 's3twlftlljty', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 49, '5gy5sia4sy4u', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 11:58:15.092978+00', '2026-09-06 12:56:54.606524+00', 'clvwk5dwoia3', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 50, 'pi2gfo4ct54o', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 12:56:54.620665+00', '2026-09-06 13:55:38.29048+00', '5gy5sia4sy4u', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 51, '54evsvtn2yyg', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 13:55:38.291515+00', '2026-09-06 15:18:44.357951+00', 'pi2gfo4ct54o', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 52, 'wbkhgs7qb7v2', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', true, '2026-09-06 15:18:44.35931+00', '2026-09-07 02:57:17.920229+00', '54evsvtn2yyg', 'b7a10269-e79c-4ae5-8529-6b1569834014'),
	('00000000-0000-0000-0000-000000000000', 53, '2yplmgocjrkx', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', false, '2026-09-07 02:57:17.922426+00', '2026-09-07 02:57:17.922426+00', 'wbkhgs7qb7v2', 'b7a10269-e79c-4ae5-8529-6b1569834014');


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: businesses; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."businesses" ("id", "owner_user_id", "legal_name", "industry", "pka_version", "created_at", "access_model_override", "commission_trigger_status", "ssm_registration_number") VALUES
	('a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'NHL Global Solution', 'Services', 'v2.0', '2026-09-04 10:13:25.801297+00', NULL, 'issued', '202603211683'),
	('5d741fe0-09ed-4a90-aa65-af905bd13ef1', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', 'Art Angkut Enterprise', 'Construction Logistic Services', 'v2.0', '2026-09-05 07:16:19.597412+00', NULL, 'issued', NULL);


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."roles" ("id", "business_id", "name", "is_system_template", "description", "default_approval_limit_myr", "created_at") VALUES
	('00000000-0000-0000-0000-000000000001', NULL, 'Owner', true, 'All domains, all capabilities, always, non-revocable, unlimited approval.', NULL, '2026-09-03 14:15:26.286601+00'),
	('00000000-0000-0000-0000-000000000002', NULL, 'Bookkeeper / Accountant', true, 'Full accounting_reports control; view+approve on sales/expense/inventory/pricing; full tax_compliance except configure; payroll view only (Vol 6_7 §5 sensitivity).', NULL, '2026-09-03 14:15:26.286601+00'),
	('00000000-0000-0000-0000-000000000003', NULL, 'Sales Agent', true, 'Capture on sales/pricing; view own commission records; nothing else.', NULL, '2026-09-03 14:15:26.286601+00'),
	('00000000-0000-0000-0000-000000000004', NULL, 'Warehouse Staff', true, 'Capture on inventory; view on sales (linked Delivery Orders); nothing else.', NULL, '2026-09-03 14:15:26.286601+00'),
	('00000000-0000-0000-0000-000000000005', NULL, 'Payroll Admin', true, 'Full control of payroll and hr_attendance_leave; nothing else.', NULL, '2026-09-03 14:15:26.286601+00'),
	('00000000-0000-0000-0000-000000000006', NULL, 'Approver (Supervisor)', true, 'Approve only on expense/sales, role-default approval limit; no capture/configure.', 2000.00, '2026-09-03 14:15:26.286601+00');


--
-- Data for Name: business_memberships; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."business_memberships" ("id", "business_id", "user_id", "role_id", "party_id", "approval_limit_myr", "status", "invited_by_membership_id", "invited_at", "accepted_at", "removed_at", "invited_email", "owner_label") VALUES
	('7701a73d-694c-4620-b7b0-0732326965ee', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '00000000-0000-0000-0000-000000000001', NULL, NULL, 'active', NULL, '2026-09-04 10:13:25.801297+00', '2026-09-04 10:13:25.801297+00', NULL, NULL, NULL),
	('988403ac-e8eb-416b-9dfc-85b02aa7252a', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', NULL, '00000000-0000-0000-0000-000000000003', NULL, NULL, 'invited', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-04 10:16:30.341028+00', NULL, NULL, 'myeffort.edutech@gmail.com', 'Salim'),
	('82fc34ba-d49b-4b2a-b386-c4b4274b4047', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '00000000-0000-0000-0000-000000000001', NULL, NULL, 'active', NULL, '2026-09-05 07:16:19.597412+00', '2026-09-05 07:16:19.597412+00', NULL, NULL, NULL);


--
-- Data for Name: devices; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."devices" ("device_id", "business_id", "device_label", "platform", "registered_at", "last_seen_at", "last_synced_server_seq", "is_primary", "revoked_at", "business_membership_id") VALUES
	('e27ba6ea-f00f-4325-a9bb-ef960c7b73d9', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', 'Web browser', 'web', '2026-09-05 08:06:44.967124+00', '2026-09-05 08:06:44.967124+00', 0, true, NULL, '82fc34ba-d49b-4b2a-b386-c4b4274b4047'),
	('541484ee-12fe-40d9-9ab0-b97b527d56a0', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'Chrome (repair)', 'web', '2026-09-05 04:50:25.668339+00', '2026-09-05 10:16:40.937092+00', 0, true, NULL, '7701a73d-694c-4620-b7b0-0732326965ee');


--
-- Data for Name: active_device_lock; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."active_device_lock" ("business_id", "active_device_id", "lock_token", "acquired_at", "business_membership_id") VALUES
	('a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '541484ee-12fe-40d9-9ab0-b97b527d56a0', '3e57b248-1b94-499f-b4b4-638880c730b5', '2026-09-05 04:50:25.668339+00', '7701a73d-694c-4620-b7b0-0732326965ee'),
	('5d741fe0-09ed-4a90-aa65-af905bd13ef1', 'e27ba6ea-f00f-4325-a9bb-ef960c7b73d9', '28dc58e1-f79d-4364-8409-2b0c086477a7', '2026-09-05 08:06:44.967124+00', '82fc34ba-d49b-4b2a-b386-c4b4274b4047');


--
-- Data for Name: approval_delegations; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: approval_tasks; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."approval_tasks" ("id", "business_id", "domain", "subject_type", "subject_id", "amount", "ai_draft_summary", "ai_confidence", "captured_by_membership_id", "assigned_membership_id", "resolved_via", "delegated_from_membership_id", "status", "decided_by_membership_id", "decided_at", "next_action", "self_approved_via_escape_valve", "created_at", "on_approval_action") VALUES
	('8c7b8872-ed8a-457a-b10c-c76e37c2febd', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'expense', 'payment_voucher', '786480a4-f102-4428-9111-f65a2aa1440c', 45.00, 'Payment voucher PV-000001 to payee for 45.00 MYR (Operating Expenses)', NULL, '7701a73d-694c-4620-b7b0-0732326965ee', '7701a73d-694c-4620-b7b0-0732326965ee', 'solo_self_resolved', NULL, 'approved', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 02:26:47.570399+00', NULL, false, '2026-09-06 02:26:47.570399+00', 'mark as paid'),
	('ed655c1f-5132-470b-af7b-db571dbd9ee1', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'expense', 'payment_voucher', '6ab67146-c16c-4dd6-9c84-291c8abeb3a7', 45.00, 'Payment voucher PV-000002 to payee for 45.00 MYR (Operating Expenses)', NULL, '7701a73d-694c-4620-b7b0-0732326965ee', '7701a73d-694c-4620-b7b0-0732326965ee', 'solo_self_resolved', NULL, 'approved', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 02:33:37.890831+00', NULL, false, '2026-09-06 02:33:37.890831+00', 'mark as paid'),
	('1387dcd3-8ca2-4c93-a797-08e675febafc', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'hr_attendance_leave', 'leave_application', '116f982d-8119-4697-984c-607ac2c2f255', NULL, 'Ahmad applying annual leave 2026-09-14 to 2026-09-16', NULL, '7701a73d-694c-4620-b7b0-0732326965ee', '7701a73d-694c-4620-b7b0-0732326965ee', 'solo_self_resolved', NULL, 'approved', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 02:38:36.040333+00', NULL, false, '2026-09-06 02:38:36.040333+00', NULL),
	('a1c6fbd7-c6ec-4da4-920a-6b94b047cf5c', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'hr_attendance_leave', 'leave_application', '39f13012-9dc1-43ae-84c3-2d94607eb783', NULL, 'Ahmad applying annual leave 2026-09-14 to 2026-09-16', NULL, '7701a73d-694c-4620-b7b0-0732326965ee', '7701a73d-694c-4620-b7b0-0732326965ee', 'solo_self_resolved', NULL, 'approved', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 03:24:43.172775+00', NULL, false, '2026-09-06 03:24:43.172775+00', NULL),
	('35a6162d-37c2-4f11-b4ae-f8a2fdcab688', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'expense', 'payment_voucher', 'dceb0173-b7c4-4588-8571-0b4ba2074670', 20.00, 'Payment voucher PV-000003 to payee for 20.00 MYR (Cost of Goods Sold)', NULL, '7701a73d-694c-4620-b7b0-0732326965ee', '7701a73d-694c-4620-b7b0-0732326965ee', 'solo_self_resolved', NULL, 'approved', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 05:16:23.901082+00', NULL, false, '2026-09-06 05:16:23.901082+00', 'mark as paid');


--
-- Data for Name: price_types; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: parties; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."parties" ("id", "business_id", "party_no", "display_name", "legal_name", "party_types", "registration_no", "tin", "sst_reg_no", "contact_phone", "contact_email", "billing_address", "price_type_id", "credit_limit", "credit_terms_days", "status", "created_by_membership_id", "created_at") VALUES
	('1dad3b3e-08a3-4b84-9257-7e76a51ae53e', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'SEED-PAYEE-001', 'Grab Petrol Station (Seed)', NULL, '{supplier}', NULL, NULL, NULL, '0123456789', NULL, NULL, NULL, NULL, NULL, 'active', NULL, '2026-09-06 02:25:19.211662+00'),
	('b6596248-3e4e-4ad6-bcfc-a7e8c2a695e6', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'SEED-EMP-001', 'Ahmad (Seed Employee)', NULL, '{employee}', NULL, NULL, NULL, '0129876543', NULL, NULL, NULL, NULL, NULL, 'active', NULL, '2026-09-06 02:25:19.211662+00');


--
-- Data for Name: attendance_records; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: backups; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: chart_of_accounts; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."chart_of_accounts" ("id", "business_id", "account_code", "account_name", "account_type", "parent_account_id", "is_system", "created_at") VALUES
	('8ab237b6-f03f-4721-a448-b5741c3d0846', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '1000', 'Cash / Bank', 'asset', NULL, true, '2026-09-04 10:13:25.801297+00'),
	('a8be6e2b-510e-450f-9b2e-f85fab958a1b', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '1100', 'Accounts Receivable', 'asset', NULL, true, '2026-09-04 10:13:25.801297+00'),
	('fd35859d-603a-4462-a721-fb4574343184', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '2000', 'Accounts Payable', 'liability', NULL, true, '2026-09-04 10:13:25.801297+00'),
	('86148fb0-481e-4d94-8a46-94a89ef45820', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '2100', 'Statutory Contributions Payable', 'liability', NULL, true, '2026-09-04 10:13:25.801297+00'),
	('09f67f64-bd99-46a2-ba5d-b217056d7d87', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '3000', 'Owner''s Equity / Drawings', 'equity', NULL, true, '2026-09-04 10:13:25.801297+00'),
	('696c6672-b943-40c4-8eaa-6436bd3e21e8', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '4000', 'Sales Revenue', 'revenue', NULL, true, '2026-09-04 10:13:25.801297+00'),
	('2b5361ef-b393-4020-8a92-abbfe1cf9afd', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '5000', 'Cost of Goods Sold', 'expense', NULL, true, '2026-09-04 10:13:25.801297+00'),
	('949f6c0d-3c96-499f-96ff-cbd21c9da67f', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '6000', 'Operating Expenses', 'expense', NULL, true, '2026-09-04 10:13:25.801297+00'),
	('44fa8a96-925e-4717-9d0c-d11488cf6b6a', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '6100', 'Supplies', 'expense', '949f6c0d-3c96-499f-96ff-cbd21c9da67f', true, '2026-09-04 10:13:25.801297+00'),
	('e015f9e8-4e6d-4087-b318-c11398cd52bf', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '6200', 'Rent', 'expense', '949f6c0d-3c96-499f-96ff-cbd21c9da67f', true, '2026-09-04 10:13:25.801297+00'),
	('0c6f7514-9790-460b-ad4d-3eda32da8a21', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '6300', 'Utilities', 'expense', '949f6c0d-3c96-499f-96ff-cbd21c9da67f', true, '2026-09-04 10:13:25.801297+00'),
	('a9bd0e24-3964-4912-94e0-b02895ee32e1', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '6400', 'Marketing', 'expense', '949f6c0d-3c96-499f-96ff-cbd21c9da67f', true, '2026-09-04 10:13:25.801297+00'),
	('6633ddff-54b0-4bef-8a12-fe889fbefff6', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '6500', 'Salaries & Wages', 'expense', '949f6c0d-3c96-499f-96ff-cbd21c9da67f', true, '2026-09-04 10:13:25.801297+00'),
	('46827027-2933-4c35-a783-03c737eceb66', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', '6900', 'Other', 'expense', '949f6c0d-3c96-499f-96ff-cbd21c9da67f', true, '2026-09-04 10:13:25.801297+00'),
	('e572b3e8-1b31-4677-80d2-9fad770371c9', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '1000', 'Cash / Bank', 'asset', NULL, true, '2026-09-05 07:16:19.597412+00'),
	('7ad42a8a-d63b-461c-8592-f805abb3f405', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '1100', 'Accounts Receivable', 'asset', NULL, true, '2026-09-05 07:16:19.597412+00'),
	('5c2d6ace-e845-49fe-b1e4-c4681318a517', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '2000', 'Accounts Payable', 'liability', NULL, true, '2026-09-05 07:16:19.597412+00'),
	('b8933bd2-cfc7-40fb-9287-187cb5dd70bb', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '2100', 'Statutory Contributions Payable', 'liability', NULL, true, '2026-09-05 07:16:19.597412+00'),
	('92e432f6-a066-47ee-880e-9fd161d49298', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '3000', 'Owner''s Equity / Drawings', 'equity', NULL, true, '2026-09-05 07:16:19.597412+00'),
	('1f6d06b7-c117-446c-838d-250cb0bc4615', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '4000', 'Sales Revenue', 'revenue', NULL, true, '2026-09-05 07:16:19.597412+00'),
	('36f37bab-c9ea-4ab9-9caf-675e8014775a', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '5000', 'Cost of Goods Sold', 'expense', NULL, true, '2026-09-05 07:16:19.597412+00'),
	('6220ab45-be76-489d-aa63-3b4bf8e6d989', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '6000', 'Operating Expenses', 'expense', NULL, true, '2026-09-05 07:16:19.597412+00'),
	('9aa8150e-7713-470f-8faa-6573307dcfe0', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '6100', 'Supplies', 'expense', '6220ab45-be76-489d-aa63-3b4bf8e6d989', true, '2026-09-05 07:16:19.597412+00'),
	('ba88e044-e855-435d-9d1c-520287129a45', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '6200', 'Rent', 'expense', '6220ab45-be76-489d-aa63-3b4bf8e6d989', true, '2026-09-05 07:16:19.597412+00'),
	('64ff5e82-6a9c-4cf5-bf89-673d2a082cde', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '6300', 'Utilities', 'expense', '6220ab45-be76-489d-aa63-3b4bf8e6d989', true, '2026-09-05 07:16:19.597412+00'),
	('3ce42027-062e-47d1-90b5-cdab16b1b9e9', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '6400', 'Marketing', 'expense', '6220ab45-be76-489d-aa63-3b4bf8e6d989', true, '2026-09-05 07:16:19.597412+00'),
	('afe69031-afd2-446c-824e-eaf045cee567', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '6500', 'Salaries & Wages', 'expense', '6220ab45-be76-489d-aa63-3b4bf8e6d989', true, '2026-09-05 07:16:19.597412+00'),
	('afd59953-f27f-4c26-ba7a-df67acf6dc47', '5d741fe0-09ed-4a90-aa65-af905bd13ef1', '6900', 'Other', 'expense', '6220ab45-be76-489d-aa63-3b4bf8e6d989', true, '2026-09-05 07:16:19.597412+00');


--
-- Data for Name: bank_accounts; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."bank_accounts" ("id", "business_id", "account_name", "ledger_account_id", "opening_balance", "created_at") VALUES
	('53da2809-8d9e-4369-96bb-4702dac5c7e1', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'Main Bank Account (Seed)', '8ab237b6-f03f-4721-a448-b5741c3d0846', 0.00, '2026-09-06 02:32:19.151166+00');


--
-- Data for Name: ledger_entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."ledger_entries" ("id", "business_id", "business_data_id", "chart_of_accounts_id", "direction", "amount", "currency", "posted_at", "reversal_of", "posted_by_membership_id", "created_at") VALUES
	('cf757c4b-8c5f-420f-bd11-f8889a67e387', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', NULL, '949f6c0d-3c96-499f-96ff-cbd21c9da67f', 'debit', 45.00, 'MYR', '2026-09-06 02:37:30.022733+00', NULL, '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 02:37:30.022733+00'),
	('5f8bd2f8-d2b8-4211-aef4-71bca92251da', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', NULL, '8ab237b6-f03f-4721-a448-b5741c3d0846', 'credit', 45.00, 'MYR', '2026-09-06 02:37:30.022733+00', NULL, '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 02:37:30.022733+00');


--
-- Data for Name: bank_statement_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: payroll_runs; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: bulk_payment_file_exports; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: business_access_model_transitions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: capture_triage; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."capture_triage" ("id", "business_id", "raw_text", "detected_domain", "status", "created_by_membership_id", "created_at") VALUES
	('b8493e3f-9be8-44f6-ae18-466918e0df2a', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'Need to call the landlord about the aircon', 'unclassified', 'resolved', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 04:29:15.373812+00'),
	('59bcb7c5-ea67-489c-b5ea-f6443cccd0a4', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'Need to call the landlord about the aircon', 'unclassified', 'dismissed', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 04:30:18.735792+00');


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: claims; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: commission_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: quotations; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: commission_calculations; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: contracts; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: contract_alerts; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: credit_limit_override_log; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: credit_notes; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: warehouses; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: delivery_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: delivery_order_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: document_number_sequences; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."document_number_sequences" ("business_id", "document_type", "prefix", "next_number", "reset_period", "last_reset_key") VALUES
	('a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'payment_voucher', 'PV', 4, 'never', NULL);


--
-- Data for Name: e_invoice_submissions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: e_invoice_submission_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: e_signature_envelopes; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: employee_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: invoice_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: leave_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."leave_types" ("id", "business_id", "name", "default_entitlement_days", "created_at") VALUES
	('24c2d32e-9e28-4a3f-9592-614fbf29fe22', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'Annual Leave (Seed)', 14.00, '2026-09-06 02:25:19.211662+00');


--
-- Data for Name: leave_applications; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."leave_applications" ("id", "business_id", "employee_party_id", "leave_type_id", "start_date", "end_date", "status", "approved_by", "created_by_membership_id", "created_at") VALUES
	('116f982d-8119-4697-984c-607ac2c2f255', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'b6596248-3e4e-4ad6-bcfc-a7e8c2a695e6', '24c2d32e-9e28-4a3f-9592-614fbf29fe22', '2026-09-14', '2026-09-16', 'approved', '7701a73d-694c-4620-b7b0-0732326965ee', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 02:38:36.040333+00'),
	('39f13012-9dc1-43ae-84c3-2d94607eb783', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'b6596248-3e4e-4ad6-bcfc-a7e8c2a695e6', '24c2d32e-9e28-4a3f-9592-614fbf29fe22', '2026-09-14', '2026-09-16', 'approved', '7701a73d-694c-4620-b7b0-0732326965ee', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 03:24:43.172775+00');


--
-- Data for Name: leave_balances; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."leave_balances" ("employee_party_id", "leave_type_id", "year", "entitled_days", "used_days") VALUES
	('b6596248-3e4e-4ad6-bcfc-a7e8c2a695e6', '24c2d32e-9e28-4a3f-9592-614fbf29fe22', 2026, 14.00, 6.00);


--
-- Data for Name: overtime_records; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: payment_vouchers; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."payment_vouchers" ("id", "business_id", "pv_no", "payee_party_id", "status", "expense_category", "document_id_receipt", "payment_method", "issue_date", "currency", "grand_total", "notes", "captured_by_membership_id", "created_at", "sst_code") VALUES
	('786480a4-f102-4428-9111-f65a2aa1440c', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'PV-000001', 'b6596248-3e4e-4ad6-bcfc-a7e8c2a695e6', 'approved', 'Operating Expenses', NULL, 'cash', '2026-09-06', 'MYR', 45.00, 'Paid RM45 to Grab for petrol', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 02:26:47.570399+00', NULL),
	('6ab67146-c16c-4dd6-9c84-291c8abeb3a7', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'PV-000002', '1dad3b3e-08a3-4b84-9257-7e76a51ae53e', 'paid', 'Operating Expenses', NULL, 'bank_transfer', '2026-09-06', 'MYR', 45.00, 'Paid RM45 to Grab for petrol', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 02:33:37.890831+00', NULL),
	('dceb0173-b7c4-4588-8571-0b4ba2074670', 'a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', 'PV-000003', 'b6596248-3e4e-4ad6-bcfc-a7e8c2a695e6', 'approved', 'Cost of Goods Sold', NULL, 'cash', '2026-09-06', 'MYR', 20.00, 'Type RM20 for annual leave application fee', '7701a73d-694c-4620-b7b0-0732326965ee', '2026-09-06 05:16:23.901082+00', NULL);


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: payslips; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."permissions" ("domain", "capability") VALUES
	('sales', 'view'),
	('pricing', 'view'),
	('expense', 'view'),
	('inventory', 'view'),
	('accounting_reports', 'view'),
	('tax_compliance', 'view'),
	('payroll', 'view'),
	('hr_attendance_leave', 'view'),
	('commission', 'view'),
	('legal_contract', 'view'),
	('settings', 'view'),
	('sales', 'capture'),
	('pricing', 'capture'),
	('expense', 'capture'),
	('inventory', 'capture'),
	('accounting_reports', 'capture'),
	('tax_compliance', 'capture'),
	('payroll', 'capture'),
	('hr_attendance_leave', 'capture'),
	('commission', 'capture'),
	('legal_contract', 'capture'),
	('settings', 'capture'),
	('sales', 'approve'),
	('pricing', 'approve'),
	('expense', 'approve'),
	('inventory', 'approve'),
	('accounting_reports', 'approve'),
	('tax_compliance', 'approve'),
	('payroll', 'approve'),
	('hr_attendance_leave', 'approve'),
	('commission', 'approve'),
	('legal_contract', 'approve'),
	('settings', 'approve'),
	('sales', 'configure'),
	('pricing', 'configure'),
	('expense', 'configure'),
	('inventory', 'configure'),
	('accounting_reports', 'configure'),
	('tax_compliance', 'configure'),
	('payroll', 'configure'),
	('hr_attendance_leave', 'configure'),
	('commission', 'configure'),
	('legal_contract', 'configure'),
	('settings', 'configure');


--
-- Data for Name: price_list_entries; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: product_import_batches; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: product_import_rows; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."profiles" ("id", "business_name", "industry", "pka_version", "created_at", "display_name") VALUES
	('a69b59de-e9c7-4da1-9b17-6c2f4d08de4f', NULL, NULL, NULL, '2026-09-04 11:09:37.33732+00', 'Hernie');


--
-- Data for Name: quotation_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."role_permissions" ("role_id", "domain", "capability") VALUES
	('00000000-0000-0000-0000-000000000001', 'sales', 'view'),
	('00000000-0000-0000-0000-000000000001', 'pricing', 'view'),
	('00000000-0000-0000-0000-000000000001', 'expense', 'view'),
	('00000000-0000-0000-0000-000000000001', 'inventory', 'view'),
	('00000000-0000-0000-0000-000000000001', 'accounting_reports', 'view'),
	('00000000-0000-0000-0000-000000000001', 'tax_compliance', 'view'),
	('00000000-0000-0000-0000-000000000001', 'payroll', 'view'),
	('00000000-0000-0000-0000-000000000001', 'hr_attendance_leave', 'view'),
	('00000000-0000-0000-0000-000000000001', 'commission', 'view'),
	('00000000-0000-0000-0000-000000000001', 'legal_contract', 'view'),
	('00000000-0000-0000-0000-000000000001', 'settings', 'view'),
	('00000000-0000-0000-0000-000000000001', 'sales', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'pricing', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'expense', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'inventory', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'accounting_reports', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'tax_compliance', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'payroll', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'hr_attendance_leave', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'commission', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'legal_contract', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'settings', 'capture'),
	('00000000-0000-0000-0000-000000000001', 'sales', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'pricing', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'expense', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'inventory', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'accounting_reports', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'tax_compliance', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'payroll', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'hr_attendance_leave', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'commission', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'legal_contract', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'settings', 'approve'),
	('00000000-0000-0000-0000-000000000001', 'sales', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'pricing', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'expense', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'inventory', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'accounting_reports', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'tax_compliance', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'payroll', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'hr_attendance_leave', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'commission', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'legal_contract', 'configure'),
	('00000000-0000-0000-0000-000000000001', 'settings', 'configure'),
	('00000000-0000-0000-0000-000000000002', 'accounting_reports', 'view'),
	('00000000-0000-0000-0000-000000000002', 'accounting_reports', 'configure'),
	('00000000-0000-0000-0000-000000000002', 'sales', 'view'),
	('00000000-0000-0000-0000-000000000002', 'sales', 'approve'),
	('00000000-0000-0000-0000-000000000002', 'expense', 'view'),
	('00000000-0000-0000-0000-000000000002', 'expense', 'approve'),
	('00000000-0000-0000-0000-000000000002', 'inventory', 'view'),
	('00000000-0000-0000-0000-000000000002', 'inventory', 'approve'),
	('00000000-0000-0000-0000-000000000002', 'pricing', 'view'),
	('00000000-0000-0000-0000-000000000002', 'pricing', 'approve'),
	('00000000-0000-0000-0000-000000000002', 'tax_compliance', 'view'),
	('00000000-0000-0000-0000-000000000002', 'tax_compliance', 'capture'),
	('00000000-0000-0000-0000-000000000002', 'tax_compliance', 'approve'),
	('00000000-0000-0000-0000-000000000002', 'payroll', 'view'),
	('00000000-0000-0000-0000-000000000003', 'sales', 'view'),
	('00000000-0000-0000-0000-000000000003', 'sales', 'capture'),
	('00000000-0000-0000-0000-000000000003', 'pricing', 'view'),
	('00000000-0000-0000-0000-000000000003', 'pricing', 'capture'),
	('00000000-0000-0000-0000-000000000003', 'commission', 'view'),
	('00000000-0000-0000-0000-000000000004', 'inventory', 'view'),
	('00000000-0000-0000-0000-000000000004', 'inventory', 'capture'),
	('00000000-0000-0000-0000-000000000004', 'sales', 'view'),
	('00000000-0000-0000-0000-000000000005', 'payroll', 'view'),
	('00000000-0000-0000-0000-000000000005', 'payroll', 'capture'),
	('00000000-0000-0000-0000-000000000005', 'payroll', 'approve'),
	('00000000-0000-0000-0000-000000000005', 'payroll', 'configure'),
	('00000000-0000-0000-0000-000000000005', 'hr_attendance_leave', 'view'),
	('00000000-0000-0000-0000-000000000005', 'hr_attendance_leave', 'capture'),
	('00000000-0000-0000-0000-000000000005', 'hr_attendance_leave', 'approve'),
	('00000000-0000-0000-0000-000000000005', 'hr_attendance_leave', 'configure'),
	('00000000-0000-0000-0000-000000000006', 'expense', 'approve'),
	('00000000-0000-0000-0000-000000000006', 'sales', 'approve');


--
-- Data for Name: salary_advances; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: segregation_of_duties_policies; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: sst_rates; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."sst_rates" ("sst_code", "tax_type", "rate", "description", "rule_version") VALUES
	('SR-10', 'sales_tax', 0.1000, 'Sales Tax — standard rate (illustrative; confirm against your own registration).', '1.0.0'),
	('SR-5', 'sales_tax', 0.0500, 'Sales Tax — reduced rate for certain goods (illustrative).', '1.0.0'),
	('SV-8', 'service_tax', 0.0800, 'Service Tax — standard rate (illustrative).', '1.0.0'),
	('SV-6', 'service_tax', 0.0600, 'Service Tax — legacy/reduced rate for certain services (illustrative).', '1.0.0'),
	('EX', 'exempt', 0.0000, 'Exempt / out of scope of SST.', '1.0.0');


--
-- Data for Name: sst_returns; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: sst_transactions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: statutory_rate_tables; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."statutory_rate_tables" ("scheme", "version", "effective_from", "rate_rules", "created_at") VALUES
	('epf', 'MY-EPF-2026', '2026-01-01', '{"employee_rate": 0.11, "employer_rate_low": 0.13, "employer_rate_high": 0.12, "employer_threshold": 5000}', '2026-09-03 14:15:26.286601+00'),
	('socso', 'MY-SOCSO-2026', '2026-01-01', '{"wage_ceiling": 6000, "employee_rate": 0.005, "employer_rate": 0.0175}', '2026-09-03 14:15:26.286601+00'),
	('eis', 'MY-EIS-2026', '2026-01-01', '{"wage_ceiling": 6000, "employee_rate": 0.002, "employer_rate": 0.002}', '2026-09-03 14:15:26.286601+00'),
	('pcb', 'MY-PCB-2026', '2026-01-01', '{"brackets": [{"rate": 0.00, "lower": 0, "upper": 5000}, {"rate": 0.01, "lower": 5000, "upper": 20000}, {"rate": 0.03, "lower": 20000, "upper": 35000}, {"rate": 0.06, "lower": 35000, "upper": 50000}, {"rate": 0.11, "lower": 50000, "upper": 70000}, {"rate": 0.19, "lower": 70000, "upper": 100000}, {"rate": 0.25, "lower": 100000, "upper": 400000}, {"rate": 0.26, "lower": 400000, "upper": 600000}, {"rate": 0.28, "lower": 600000, "upper": 2000000}, {"rate": 0.30, "lower": 2000000, "upper": null}], "epf_relief_cap": 7000, "personal_relief": 9000}', '2026-09-03 14:15:26.286601+00');


--
-- Data for Name: stock_levels; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: stock_movements; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: stock_takes; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: stock_take_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: sync_envelopes; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES
	('backups', 'backups', NULL, '2026-09-03 14:15:26.286601+00', '2026-09-03 14:15:26.286601+00', false, false, NULL, NULL, NULL, 'STANDARD')
ON CONFLICT (id) DO NOTHING;


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: iceberg_namespaces; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: iceberg_tables; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: hooks; Type: TABLE DATA; Schema: supabase_functions; Owner: supabase_functions_admin
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 53, true);


--
-- Name: sync_envelopes_server_seq_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."sync_envelopes_server_seq_seq"', 1, false);


-- (removed) hooks_id_seq setval skipped: supabase_functions internal schema
-- sequence not present on the target cloud project; irrelevant to app data.


--
-- PostgreSQL database dump complete
--

-- \unrestrict K7ZSBdUyLa9elbK2N7UmKw8yF1ONtJVjIhQ2bkaXAJ4loxIT0ayOOMK0olSAvXU

RESET ALL;


set session_replication_role = default;
-- END_DATA_LOAD_WRAPPER
commit;
