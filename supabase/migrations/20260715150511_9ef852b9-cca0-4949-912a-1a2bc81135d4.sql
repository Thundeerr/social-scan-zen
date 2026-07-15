
-- discovery_candidates
DROP POLICY IF EXISTS "own candidates select" ON public.discovery_candidates;
DROP POLICY IF EXISTS "own candidates insert" ON public.discovery_candidates;
DROP POLICY IF EXISTS "own candidates update" ON public.discovery_candidates;
DROP POLICY IF EXISTS "own candidates delete" ON public.discovery_candidates;
CREATE POLICY "own candidates select" ON public.discovery_candidates FOR SELECT USING (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "own candidates insert" ON public.discovery_candidates FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "own candidates update" ON public.discovery_candidates FOR UPDATE USING (auth.uid() = user_id AND public.is_operator(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "own candidates delete" ON public.discovery_candidates FOR DELETE USING (auth.uid() = user_id AND public.is_operator(auth.uid()));

-- discovery_signals
DROP POLICY IF EXISTS "own signals select" ON public.discovery_signals;
DROP POLICY IF EXISTS "own signals insert" ON public.discovery_signals;
DROP POLICY IF EXISTS "own signals delete" ON public.discovery_signals;
CREATE POLICY "own signals select" ON public.discovery_signals FOR SELECT USING (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "own signals insert" ON public.discovery_signals FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "own signals delete" ON public.discovery_signals FOR DELETE USING (auth.uid() = user_id AND public.is_operator(auth.uid()));

-- discovery_preferences
DROP POLICY IF EXISTS "own prefs all" ON public.discovery_preferences;
CREATE POLICY "own prefs all" ON public.discovery_preferences FOR ALL USING (auth.uid() = user_id AND public.is_operator(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));

-- discovery_cooccurrences
DROP POLICY IF EXISTS "Operators read own cooccurrences" ON public.discovery_cooccurrences;
DROP POLICY IF EXISTS "Operators write own cooccurrences" ON public.discovery_cooccurrences;
DROP POLICY IF EXISTS "Operators update own cooccurrences" ON public.discovery_cooccurrences;
CREATE POLICY "Operators read own cooccurrences" ON public.discovery_cooccurrences FOR SELECT USING (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "Operators write own cooccurrences" ON public.discovery_cooccurrences FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "Operators update own cooccurrences" ON public.discovery_cooccurrences FOR UPDATE USING (auth.uid() = user_id AND public.is_operator(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));

-- discovery_blacklist
DROP POLICY IF EXISTS "own blacklist all" ON public.discovery_blacklist;
CREATE POLICY "own blacklist all" ON public.discovery_blacklist FOR ALL USING (auth.uid() = user_id AND public.is_operator(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));

-- ig_connections
DROP POLICY IF EXISTS "ig_connections owner read" ON public.ig_connections;
DROP POLICY IF EXISTS "ig_connections owner insert" ON public.ig_connections;
DROP POLICY IF EXISTS "ig_connections owner update" ON public.ig_connections;
DROP POLICY IF EXISTS "ig_connections owner delete" ON public.ig_connections;
CREATE POLICY "ig_connections owner read" ON public.ig_connections FOR SELECT USING (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "ig_connections owner insert" ON public.ig_connections FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "ig_connections owner update" ON public.ig_connections FOR UPDATE USING (auth.uid() = user_id AND public.is_operator(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "ig_connections owner delete" ON public.ig_connections FOR DELETE USING (auth.uid() = user_id AND public.is_operator(auth.uid()));

-- publish_jobs
DROP POLICY IF EXISTS "publish_jobs owner read" ON public.publish_jobs;
DROP POLICY IF EXISTS "publish_jobs owner update" ON public.publish_jobs;
DROP POLICY IF EXISTS "publish_jobs owner delete" ON public.publish_jobs;
CREATE POLICY "publish_jobs owner read" ON public.publish_jobs FOR SELECT USING (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "publish_jobs owner update" ON public.publish_jobs FOR UPDATE USING (auth.uid() = user_id AND public.is_operator(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_operator(auth.uid()));
CREATE POLICY "publish_jobs owner delete" ON public.publish_jobs FOR DELETE USING (auth.uid() = user_id AND public.is_operator(auth.uid()));

-- tracked_locations: restrict writes to operators
DROP POLICY IF EXISTS "Owners manage their locations" ON public.tracked_locations;
CREATE POLICY "Operators insert their locations" ON public.tracked_locations FOR INSERT WITH CHECK (auth.uid() = created_by AND public.is_operator(auth.uid()));
CREATE POLICY "Operators update their locations" ON public.tracked_locations FOR UPDATE USING (auth.uid() = created_by AND public.is_operator(auth.uid())) WITH CHECK (auth.uid() = created_by AND public.is_operator(auth.uid()));
CREATE POLICY "Operators delete their locations" ON public.tracked_locations FOR DELETE USING (auth.uid() = created_by AND public.is_operator(auth.uid()));
CREATE POLICY "Owners read their locations" ON public.tracked_locations FOR SELECT USING (auth.uid() = created_by OR public.is_operator(auth.uid()));
