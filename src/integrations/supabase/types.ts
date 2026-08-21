export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          actor_id: string | null
          created_at: string
          created_by: string | null
          description: string
          event_type: string
          id: string
          metadata: Json | null
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          event_type: string
          id?: string
          metadata?: Json | null
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      asset_downloads: {
        Row: {
          asset_id: string
          created_at: string
          downloaded_at: string
          downloaded_by: string | null
          file_size: number | null
          filename: string | null
          id: string
          media_type: string | null
          media_url: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          downloaded_at?: string
          downloaded_by?: string | null
          file_size?: number | null
          filename?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          downloaded_at?: string
          downloaded_by?: string | null
          file_size?: number | null
          filename?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_downloads_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_status: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          state: Database["public"]["Enums"]["review_state"]
          updated_at: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          state?: Database["public"]["Enums"]["review_state"]
          updated_at?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          state?: Database["public"]["Enums"]["review_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_status_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          account_id: string | null
          ai_confidence: number | null
          ai_reasons: Json | null
          ai_verdict: string | null
          caption: string | null
          comments: number
          created_at: string
          created_by: string | null
          detected_at: string
          external_id: string | null
          id: string
          ig_permalink: string | null
          ig_post_id: string | null
          last_seen_at: string
          likes: number
          location_id: string | null
          media_type: Database["public"]["Enums"]["asset_media_type"]
          media_url: string | null
          posted_at: string | null
          publish_status: string | null
          source_url: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          ai_confidence?: number | null
          ai_reasons?: Json | null
          ai_verdict?: string | null
          caption?: string | null
          comments?: number
          created_at?: string
          created_by?: string | null
          detected_at?: string
          external_id?: string | null
          id?: string
          ig_permalink?: string | null
          ig_post_id?: string | null
          last_seen_at?: string
          likes?: number
          location_id?: string | null
          media_type?: Database["public"]["Enums"]["asset_media_type"]
          media_url?: string | null
          posted_at?: string | null
          publish_status?: string | null
          source_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          ai_confidence?: number | null
          ai_reasons?: Json | null
          ai_verdict?: string | null
          caption?: string | null
          comments?: number
          created_at?: string
          created_by?: string | null
          detected_at?: string
          external_id?: string | null
          id?: string
          ig_permalink?: string | null
          ig_post_id?: string | null
          last_seen_at?: string
          likes?: number
          location_id?: string | null
          media_type?: Database["public"]["Enums"]["asset_media_type"]
          media_url?: string | null
          posted_at?: string | null
          publish_status?: string | null
          source_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tracked_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "tracked_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_events: {
        Row: {
          content_post_id: string
          created_at: string
          detail: Json
          event_type: string
          id: string
        }
        Insert: {
          content_post_id: string
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
        }
        Update: {
          content_post_id?: string
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_events_content_post_id_fkey"
            columns: ["content_post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_posts: {
        Row: {
          alt_text: string
          approved_at: string | null
          approved_by: string | null
          batch_key: string | null
          caption: string
          content_pillar: string
          cover_storage_path: string | null
          created_at: string
          first_comment: string
          hook: string
          highlight_enabled: boolean
          highlight_name: string
          id: string
          imported_at: string | null
          last_publish_error: string | null
          manifest_version: number
          media_cleaned_at: string | null
          media_cleanup_after: string | null
          media_manifest: Json
          media_sha256: string | null
          post_key: string
          publish_attempts: number
          publish_lease_until: string | null
          publish_started_at: string | null
          published_at: string | null
          reel_storage_path: string | null
          review_note: string | null
          scheduled_for: string | null
          share_to_feed: boolean
          status: string
          story_link_label: string
          story_link_url: string
          story_publish_mode: string
          story_storage_path: string | null
          title: string
          updated_at: string
          user_id: string
          quality_report: Json
        }
        Insert: {
          alt_text?: string
          approved_at?: string | null
          approved_by?: string | null
          batch_key?: string | null
          caption?: string
          content_pillar?: string
          cover_storage_path?: string | null
          created_at?: string
          first_comment?: string
          hook?: string
          highlight_enabled?: boolean
          highlight_name?: string
          id?: string
          imported_at?: string | null
          last_publish_error?: string | null
          manifest_version?: number
          media_cleaned_at?: string | null
          media_cleanup_after?: string | null
          media_manifest?: Json
          media_sha256?: string | null
          post_key: string
          publish_attempts?: number
          publish_lease_until?: string | null
          publish_started_at?: string | null
          published_at?: string | null
          reel_storage_path?: string | null
          review_note?: string | null
          scheduled_for?: string | null
          share_to_feed?: boolean
          status?: string
          story_link_label?: string
          story_link_url?: string
          story_publish_mode?: string
          story_storage_path?: string | null
          title: string
          updated_at?: string
          user_id: string
          quality_report?: Json
        }
        Update: {
          alt_text?: string
          approved_at?: string | null
          approved_by?: string | null
          batch_key?: string | null
          caption?: string
          content_pillar?: string
          cover_storage_path?: string | null
          created_at?: string
          first_comment?: string
          hook?: string
          highlight_enabled?: boolean
          highlight_name?: string
          id?: string
          imported_at?: string | null
          last_publish_error?: string | null
          manifest_version?: number
          media_cleaned_at?: string | null
          media_cleanup_after?: string | null
          media_manifest?: Json
          media_sha256?: string | null
          post_key?: string
          publish_attempts?: number
          publish_lease_until?: string | null
          publish_started_at?: string | null
          published_at?: string | null
          reel_storage_path?: string | null
          review_note?: string | null
          scheduled_for?: string | null
          share_to_feed?: boolean
          status?: string
          story_link_label?: string
          story_link_url?: string
          story_publish_mode?: string
          story_storage_path?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          quality_report?: Json
        }
        Relationships: []
      }
      content_publications: {
        Row: {
          attempts: number
          channel: string
          content_post_id: string
          created_at: string
          id: string
          last_error: string | null
          permalink: string | null
          platform_container_id: string | null
          platform_media_id: string | null
          published_at: string | null
          depends_on_channel: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel: string
          content_post_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          permalink?: string | null
          platform_container_id?: string | null
          platform_media_id?: string | null
          published_at?: string | null
          depends_on_channel?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: string
          content_post_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          permalink?: string | null
          platform_container_id?: string | null
          platform_media_id?: string | null
          published_at?: string | null
          depends_on_channel?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_publications_content_post_id_fkey"
            columns: ["content_post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_blacklist: {
        Row: {
          created_at: string
          id: string
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      discovery_candidates: {
        Row: {
          aesthetic_score: number | null
          ai_summary: string | null
          authenticity_score: number | null
          avatar_url: string | null
          confidence: number
          created_at: string
          depth: number
          estimated_niche: string | null
          estimated_post_frequency: string | null
          first_seen_at: string
          followers: number | null
          following: number | null
          full_name: string | null
          headline_signals: Json
          id: string
          is_private: boolean | null
          is_verified: boolean | null
          last_ai_at: string | null
          last_seen_at: string
          luxury_score: number | null
          p_commercial_brand: number | null
          p_private_individual: number | null
          parent_candidate_id: string | null
          posts_count: number | null
          quality_score: number | null
          rank_score: number
          score_reasons: Json
          signal_count: number
          state: Database["public"]["Enums"]["discovery_state"]
          travel_score: number | null
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          aesthetic_score?: number | null
          ai_summary?: string | null
          authenticity_score?: number | null
          avatar_url?: string | null
          confidence?: number
          created_at?: string
          depth?: number
          estimated_niche?: string | null
          estimated_post_frequency?: string | null
          first_seen_at?: string
          followers?: number | null
          following?: number | null
          full_name?: string | null
          headline_signals?: Json
          id?: string
          is_private?: boolean | null
          is_verified?: boolean | null
          last_ai_at?: string | null
          last_seen_at?: string
          luxury_score?: number | null
          p_commercial_brand?: number | null
          p_private_individual?: number | null
          parent_candidate_id?: string | null
          posts_count?: number | null
          quality_score?: number | null
          rank_score?: number
          score_reasons?: Json
          signal_count?: number
          state?: Database["public"]["Enums"]["discovery_state"]
          travel_score?: number | null
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          aesthetic_score?: number | null
          ai_summary?: string | null
          authenticity_score?: number | null
          avatar_url?: string | null
          confidence?: number
          created_at?: string
          depth?: number
          estimated_niche?: string | null
          estimated_post_frequency?: string | null
          first_seen_at?: string
          followers?: number | null
          following?: number | null
          full_name?: string | null
          headline_signals?: Json
          id?: string
          is_private?: boolean | null
          is_verified?: boolean | null
          last_ai_at?: string | null
          last_seen_at?: string
          luxury_score?: number | null
          p_commercial_brand?: number | null
          p_private_individual?: number | null
          parent_candidate_id?: string | null
          posts_count?: number | null
          quality_score?: number | null
          rank_score?: number
          score_reasons?: Json
          signal_count?: number
          state?: Database["public"]["Enums"]["discovery_state"]
          travel_score?: number | null
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_candidates_parent_candidate_id_fkey"
            columns: ["parent_candidate_id"]
            isOneToOne: false
            referencedRelation: "discovery_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_cooccurrences: {
        Row: {
          a_id: string
          b_id: string
          count: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          a_id: string
          b_id: string
          count?: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          a_id?: string
          b_id?: string
          count?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_cooccurrences_a_id_fkey"
            columns: ["a_id"]
            isOneToOne: false
            referencedRelation: "discovery_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_cooccurrences_b_id_fkey"
            columns: ["b_id"]
            isOneToOne: false
            referencedRelation: "discovery_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_preferences: {
        Row: {
          avg_aesthetic: number
          avg_authenticity: number
          avg_luxury: number
          avg_quality: number
          avg_travel: number
          niche_weights: Json
          pref_commercial: number
          pref_private: number
          sample_size: number
          signal_weights: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_aesthetic?: number
          avg_authenticity?: number
          avg_luxury?: number
          avg_quality?: number
          avg_travel?: number
          niche_weights?: Json
          pref_commercial?: number
          pref_private?: number
          sample_size?: number
          signal_weights?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_aesthetic?: number
          avg_authenticity?: number
          avg_luxury?: number
          avg_quality?: number
          avg_travel?: number
          niche_weights?: Json
          pref_commercial?: number
          pref_private?: number
          sample_size?: number
          signal_weights?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      discovery_signals: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          seed_account_id: string | null
          seed_hashtag: string | null
          seed_location_id: string | null
          source_type: Database["public"]["Enums"]["discovery_source_type"]
          user_id: string
          username: string
          weight: number
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          seed_account_id?: string | null
          seed_hashtag?: string | null
          seed_location_id?: string | null
          source_type: Database["public"]["Enums"]["discovery_source_type"]
          user_id: string
          username: string
          weight?: number
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          seed_account_id?: string | null
          seed_hashtag?: string | null
          seed_location_id?: string | null
          source_type?: Database["public"]["Enums"]["discovery_source_type"]
          user_id?: string
          username?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "discovery_signals_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "discovery_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_signals_seed_account_id_fkey"
            columns: ["seed_account_id"]
            isOneToOne: false
            referencedRelation: "tracked_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_signals_seed_location_id_fkey"
            columns: ["seed_location_id"]
            isOneToOne: false
            referencedRelation: "tracked_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_connections: {
        Row: {
          api_base_url: string
          created_at: string
          id: string
          ig_user_id: string
          ig_username: string
          last_error: string | null
          page_access_token: string
          page_id: string
          status: string
          token_expires_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_base_url?: string
          created_at?: string
          id?: string
          ig_user_id: string
          ig_username: string
          last_error?: string | null
          page_access_token: string
          page_id: string
          status?: string
          token_expires_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_base_url?: string
          created_at?: string
          id?: string
          ig_user_id?: string
          ig_username?: string
          last_error?: string | null
          page_access_token?: string
          page_id?: string
          status?: string
          token_expires_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      monitor_accounts: {
        Row: {
          created_at: string
          enabled: boolean
          high_frequency_opt_in: boolean
          id: string
          interval_minutes: number | null
          is_private: boolean | null
          last_checked_at: string | null
          last_error: string | null
          last_event_at: string | null
          last_failed_check_at: string | null
          next_check_at: string
          normalized_username: string
          processing_started_at: string | null
          status_initialized: boolean
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          high_frequency_opt_in?: boolean
          id?: string
          interval_minutes?: number | null
          is_private?: boolean | null
          last_checked_at?: string | null
          last_error?: string | null
          last_event_at?: string | null
          last_failed_check_at?: string | null
          next_check_at?: string
          normalized_username: string
          processing_started_at?: string | null
          status_initialized?: boolean
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          high_frequency_opt_in?: boolean
          id?: string
          interval_minutes?: number | null
          is_private?: boolean | null
          last_checked_at?: string | null
          last_error?: string | null
          last_event_at?: string | null
          last_failed_check_at?: string | null
          next_check_at?: string
          normalized_username?: string
          processing_started_at?: string | null
          status_initialized?: boolean
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      monitor_action_templates: {
        Row: {
          account_id: string
          created_at: string
          dry_run: boolean
          enabled: boolean
          id: string
          name: string
          position: number
          quantity: number
          service_reference: string | null
          target_template: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          dry_run?: boolean
          enabled?: boolean
          id?: string
          name: string
          position?: number
          quantity?: number
          service_reference?: string | null
          target_template?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          dry_run?: boolean
          enabled?: boolean
          id?: string
          name?: string
          position?: number
          quantity?: number
          service_reference?: string | null
          target_template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitor_action_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "monitor_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_actions: {
        Row: {
          account_id: string
          attempt_count: number
          blocked_reason: string | null
          created_at: string
          dispatched_at: string | null
          error_message: string | null
          event_id: string
          id: string
          next_attempt_at: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_checked_at: string | null
          quantity: number | null
          request_excerpt: Json | null
          response_excerpt: Json | null
          service_reference: string | null
          status: string
          target: string
          template_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          attempt_count?: number
          blocked_reason?: string | null
          created_at?: string
          dispatched_at?: string | null
          error_message?: string | null
          event_id: string
          id?: string
          next_attempt_at?: string | null
          provider_reference?: string | null
          provider_status?: string | null
          provider_status_checked_at?: string | null
          quantity?: number | null
          request_excerpt?: Json | null
          response_excerpt?: Json | null
          service_reference?: string | null
          status?: string
          target: string
          template_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          attempt_count?: number
          blocked_reason?: string | null
          created_at?: string
          dispatched_at?: string | null
          error_message?: string | null
          event_id?: string
          id?: string
          next_attempt_at?: string | null
          provider_reference?: string | null
          provider_status?: string | null
          provider_status_checked_at?: string | null
          quantity?: number | null
          request_excerpt?: Json | null
          response_excerpt?: Json | null
          service_reference?: string | null
          status?: string
          target?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitor_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "monitor_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitor_actions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "monitor_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitor_actions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "monitor_action_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_checks: {
        Row: {
          account_id: string
          checked_at: string
          current_is_private: boolean | null
          error_message: string | null
          id: string
          previous_is_private: boolean | null
          response_excerpt: string | null
          result: string
        }
        Insert: {
          account_id: string
          checked_at?: string
          current_is_private?: boolean | null
          error_message?: string | null
          id?: string
          previous_is_private?: boolean | null
          response_excerpt?: string | null
          result: string
        }
        Update: {
          account_id?: string
          checked_at?: string
          current_is_private?: boolean | null
          error_message?: string | null
          id?: string
          previous_is_private?: boolean | null
          response_excerpt?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitor_checks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "monitor_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_events: {
        Row: {
          account_id: string
          cooldown_minutes: number | null
          cooldown_suppressed: boolean
          detected_at: string
          event_type: string
          id: string
          status: string
          transition_key: string
          trigger_type: string
          user_id: string
        }
        Insert: {
          account_id: string
          cooldown_minutes?: number | null
          cooldown_suppressed?: boolean
          detected_at?: string
          event_type?: string
          id?: string
          status?: string
          transition_key: string
          trigger_type: string
          user_id: string
        }
        Update: {
          account_id?: string
          cooldown_minutes?: number | null
          cooldown_suppressed?: boolean
          detected_at?: string
          event_type?: string
          id?: string
          status?: string
          transition_key?: string
          trigger_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitor_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "monitor_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_scheduler_runs: {
        Row: {
          checked_accounts: number
          completed_at: string | null
          created_actions: number
          created_events: number
          errors: number
          id: string
          started_at: string
          status: string
        }
        Insert: {
          checked_accounts?: number
          completed_at?: string | null
          created_actions?: number
          created_events?: number
          errors?: number
          id?: string
          started_at?: string
          status?: string
        }
        Update: {
          checked_accounts?: number
          completed_at?: string | null
          created_actions?: number
          created_events?: number
          errors?: number
          id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      monitor_settings: {
        Row: {
          adapter_base_url: string
          adapter_configured_at: string | null
          adapter_default_quantity: number | null
          adapter_service_reference: string | null
          automation_enabled: boolean
          batch_size: number
          cooldown_minutes: number
          created_at: string
          daily_action_cap: number
          default_interval_minutes: number
          max_quantity_per_action: number
          min_provider_balance: number
          monthly_action_cap: number
          orders_paused: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          adapter_base_url?: string
          adapter_configured_at?: string | null
          adapter_default_quantity?: number | null
          adapter_service_reference?: string | null
          automation_enabled?: boolean
          batch_size?: number
          cooldown_minutes?: number
          created_at?: string
          daily_action_cap?: number
          default_interval_minutes?: number
          max_quantity_per_action?: number
          min_provider_balance?: number
          monthly_action_cap?: number
          orders_paused?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          adapter_base_url?: string
          adapter_configured_at?: string | null
          adapter_default_quantity?: number | null
          adapter_service_reference?: string | null
          automation_enabled?: boolean
          batch_size?: number
          cooldown_minutes?: number
          created_at?: string
          daily_action_cap?: number
          default_interval_minutes?: number
          max_quantity_per_action?: number
          min_provider_balance?: number
          monthly_action_cap?: number
          orders_paused?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          publishing_paused: boolean
          telegram_chat_id: string | null
          telegram_enabled: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          publishing_paused?: boolean
          telegram_chat_id?: string | null
          telegram_enabled?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          publishing_paused?: boolean
          telegram_chat_id?: string | null
          telegram_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      provider_budget: {
        Row: {
          id: boolean
          monthly_cap: number
          updated_at: string
          updated_by: string | null
          warn_at_percent: number
        }
        Insert: {
          id?: boolean
          monthly_cap?: number
          updated_at?: string
          updated_by?: string | null
          warn_at_percent?: number
        }
        Update: {
          id?: boolean
          monthly_cap?: number
          updated_at?: string
          updated_by?: string | null
          warn_at_percent?: number
        }
        Relationships: []
      }
      publish_jobs: {
        Row: {
          asset_id: string
          attempts: number
          caption: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          ig_container_id: string | null
          ig_permalink: string | null
          ig_post_id: string | null
          rehosted_url: string | null
          scheduled_for: string
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_id: string
          attempts?: number
          caption?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          ig_container_id?: string | null
          ig_permalink?: string | null
          ig_post_id?: string | null
          rehosted_url?: string | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          attempts?: number
          caption?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          ig_container_id?: string | null
          ig_permalink?: string | null
          ig_post_id?: string | null
          rehosted_url?: string | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_jobs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      scanner_runs: {
        Row: {
          account_id: string | null
          accounts_scanned: number
          assets_detected: number
          assets_duplicates: number
          assets_found: number
          attempt: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          location_id: string | null
          phase: string | null
          phase_detail: string | null
          scheduled_for: string
          started_at: string | null
          status: Database["public"]["Enums"]["scanner_run_status"]
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          accounts_scanned?: number
          assets_detected?: number
          assets_duplicates?: number
          assets_found?: number
          attempt?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          location_id?: string | null
          phase?: string | null
          phase_detail?: string | null
          scheduled_for?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["scanner_run_status"]
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          accounts_scanned?: number
          assets_detected?: number
          assets_duplicates?: number
          assets_found?: number
          attempt?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          location_id?: string | null
          phase?: string | null
          phase_detail?: string | null
          scheduled_for?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["scanner_run_status"]
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scanner_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tracked_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scanner_runs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "tracked_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_accounts: {
        Row: {
          avatar_url: string | null
          consecutive_failures: number
          created_at: string
          created_by: string | null
          display_name: string
          followers: string | null
          id: string
          last_discovery_at: string | null
          last_error: string | null
          last_scan_at: string | null
          next_scan_at: string | null
          notes: string | null
          origin_candidate_id: string | null
          source: string
          status: Database["public"]["Enums"]["account_status"]
          tier: Database["public"]["Enums"]["priority_tier"]
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          display_name: string
          followers?: string | null
          id?: string
          last_discovery_at?: string | null
          last_error?: string | null
          last_scan_at?: string | null
          next_scan_at?: string | null
          notes?: string | null
          origin_candidate_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["account_status"]
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          display_name?: string
          followers?: string | null
          id?: string
          last_discovery_at?: string | null
          last_error?: string | null
          last_scan_at?: string | null
          next_scan_at?: string | null
          notes?: string | null
          origin_candidate_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["account_status"]
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_accounts_origin_candidate_id_fkey"
            columns: ["origin_candidate_id"]
            isOneToOne: false
            referencedRelation: "discovery_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_locations: {
        Row: {
          consecutive_failures: number
          created_at: string
          created_by: string
          id: string
          last_discovery_at: string | null
          last_error: string | null
          last_scan_at: string | null
          location_id: string
          name: string
          next_scan_at: string
          slug: string | null
          status: string
          tier: string
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          created_by: string
          id?: string
          last_discovery_at?: string | null
          last_error?: string | null
          last_scan_at?: string | null
          location_id: string
          name: string
          next_scan_at?: string
          slug?: string | null
          status?: string
          tier?: string
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          created_by?: string
          id?: string
          last_discovery_at?: string | null
          last_error?: string | null
          last_scan_at?: string | null
          location_id?: string
          name?: string
          next_scan_at?: string
          slug?: string | null
          status?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      watchlist_accounts: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          id: string
          updated_at: string
          watchlist_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          watchlist_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          watchlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tracked_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watchlist_accounts_watchlist_id_fkey"
            columns: ["watchlist_id"]
            isOneToOne: false
            referencedRelation: "watchlists"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlists: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          tier: Database["public"]["Enums"]["priority_tier"]
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_public: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_access_asset: { Args: { _asset_id: string }; Returns: boolean }
      confirm_content_handoff: {
        Args: { _channel: string; _content_post_id: string }
        Returns: undefined
      }
      claim_due_monitor_accounts: {
        Args: { _limit?: number; _stale_after_minutes?: number }
        Returns: {
          created_at: string
          enabled: boolean
          high_frequency_opt_in: boolean
          id: string
          interval_minutes: number | null
          is_private: boolean | null
          last_checked_at: string | null
          last_error: string | null
          last_event_at: string | null
          last_failed_check_at: string | null
          next_check_at: string
          normalized_username: string
          processing_started_at: string | null
          status_initialized: boolean
          updated_at: string
          user_id: string
          username: string
        }[]
        SetofOptions: {
          from: "*"
          to: "monitor_accounts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_operator: { Args: { _user_id: string }; Returns: boolean }
      is_workspace_owner: { Args: { _user_id: string }; Returns: boolean }
      owns_monitor_account: { Args: { _account_id: string }; Returns: boolean }
      owns_or_is_admin: { Args: { _owner: string }; Returns: boolean }
      provider_budget_usage: {
        Args: { _end: string; _start: string }
        Returns: Json
      }
      review_content_post: {
        Args: {
          _content_post_id: string
          _decision: string
          _note?: string | null
        }
        Returns: undefined
      }
      schedule_content_post: {
        Args: { _content_post_id: string; _scheduled_for: string }
        Returns: undefined
      }
    }
    Enums: {
      account_status: "active" | "paused"
      app_role: "owner" | "cofounder"
      asset_media_type: "image" | "video" | "carousel" | "reel" | "story"
      discovery_source_type:
        | "tagged_collaborator"
        | "tagged_user"
        | "co_appearance"
        | "location_cooccurrence"
        | "hashtag_cooccurrence"
        | "account_mention"
        | "provider_recommendation"
      discovery_state: "new" | "tracked" | "ignored" | "blacklisted"
      priority_tier: "S" | "A" | "B" | "C"
      review_state:
        | "priority"
        | "worth_reviewing"
        | "later"
        | "reviewed"
        | "approved"
        | "dismissed"
        | "archived"
      scanner_run_status: "queued" | "running" | "completed" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "paused"],
      app_role: ["owner", "cofounder"],
      asset_media_type: ["image", "video", "carousel", "reel", "story"],
      discovery_source_type: [
        "tagged_collaborator",
        "tagged_user",
        "co_appearance",
        "location_cooccurrence",
        "hashtag_cooccurrence",
        "account_mention",
        "provider_recommendation",
      ],
      discovery_state: ["new", "tracked", "ignored", "blacklisted"],
      priority_tier: ["S", "A", "B", "C"],
      review_state: [
        "priority",
        "worth_reviewing",
        "later",
        "reviewed",
        "approved",
        "dismissed",
        "archived",
      ],
      scanner_run_status: ["queued", "running", "completed", "failed"],
    },
  },
} as const

