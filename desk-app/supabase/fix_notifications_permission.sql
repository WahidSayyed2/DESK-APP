-- =========================================================
-- FIX: "permission denied for table notifications"
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- This grants logged-in users the base table access that RLS
-- policies then further restrict — without this grant, RLS
-- policies never even get evaluated.
-- =========================================================

grant select, insert, update, delete on notifications to authenticated;
