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
      business_cost_allocations: {
        Row: {
          currency: string
          effective_from: string
          label: string
          model: string
          monthly_cents: number
          note: string
          planned: boolean
          reference: string
          user_id: string
        }
        Insert: {
          currency: string
          effective_from: string
          label: string
          model: string
          monthly_cents: number
          note: string
          planned?: boolean
          reference: string
          user_id: string
        }
        Update: {
          currency?: string
          effective_from?: string
          label?: string
          model?: string
          monthly_cents?: number
          note?: string
          planned?: boolean
          reference?: string
          user_id?: string
        }
        Relationships: []
      }
      business_cost_entries: {
        Row: {
          cents: number
          day: string
          end_day: string | null
          id: string
          kind: string
          label: string
          note: string
          reference: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cents: number
          day: string
          end_day?: string | null
          id?: string
          kind: string
          label: string
          note?: string
          reference: string
          scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cents?: number
          day?: string
          end_day?: string | null
          id?: string
          kind?: string
          label?: string
          note?: string
          reference?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      business_metric_snapshots: {
        Row: {
          id: string
          note: string
          observed_at: string
          period_end: string
          period_start: string
          source: string
          user_id: string
          values: Json
        }
        Insert: {
          id?: string
          note: string
          observed_at: string
          period_end: string
          period_start: string
          source: string
          user_id: string
          values: Json
        }
        Update: {
          id?: string
          note?: string
          observed_at?: string
          period_end?: string
          period_start?: string
          source?: string
          user_id?: string
          values?: Json
        }
        Relationships: []
      }
      business_report_deliveries: {
        Row: {
          created_at: string
          key: string
          message_id: number | null
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          message_id?: number | null
          state?: string
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          message_id?: number | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      business_report_settings: {
        Row: {
          enabled: boolean
          monthly_budget_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          monthly_budget_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          monthly_budget_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      catalogue_clip_recipients: {
        Row: {
          clip_id: string
          model: string
          receipt_kind: string
          received_at: string | null
          recipient_key: string
          recorded_at: string
          user_id: string
        }
        Insert: {
          clip_id: string
          model: string
          receipt_kind: string
          received_at?: string | null
          recipient_key: string
          recorded_at?: string
          user_id: string
        }
        Update: {
          clip_id?: string
          model?: string
          receipt_kind?: string
          received_at?: string | null
          recipient_key?: string
          recorded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_clip_recipients_clip_id_user_id_model_fkey"
            columns: ["clip_id", "user_id", "model"]
            isOneToOne: false
            referencedRelation: "catalogue_clips"
            referencedColumns: ["id", "user_id", "model"]
          },
        ]
      }
      catalogue_clips: {
        Row: {
          assignment: string
          clip_code: string
          created_at: string
          desktop_source: Json | null
          id: string
          model: string
          pipeline_job_id: string | null
          review_item_id: string | null
          user_id: string
        }
        Insert: {
          assignment?: string
          clip_code: string
          created_at?: string
          desktop_source?: Json | null
          id?: string
          model: string
          pipeline_job_id?: string | null
          review_item_id?: string | null
          user_id: string
        }
        Update: {
          assignment?: string
          clip_code?: string
          created_at?: string
          desktop_source?: Json | null
          id?: string
          model?: string
          pipeline_job_id?: string | null
          review_item_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_clips_pipeline_job_id_user_id_model_fkey"
            columns: ["pipeline_job_id", "user_id", "model"]
            isOneToOne: false
            referencedRelation: "model_pipeline_jobs"
            referencedColumns: ["id", "user_id", "model"]
          },
          {
            foreignKeyName: "catalogue_clips_review_item_id_user_id_model_fkey"
            columns: ["review_item_id", "user_id", "model"]
            isOneToOne: false
            referencedRelation: "content_review_items"
            referencedColumns: ["id", "user_id", "model"]
          },
        ]
      }
      catalogue_offer_clips: {
        Row: {
          assignment: string
          clip_id: string
          model: string
          offer_id: string
          user_id: string
        }
        Insert: {
          assignment?: string
          clip_id: string
          model: string
          offer_id: string
          user_id: string
        }
        Update: {
          assignment?: string
          clip_id?: string
          model?: string
          offer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_offer_clips_clip_id_user_id_model_assignment_fkey"
            columns: ["clip_id", "user_id", "model", "assignment"]
            isOneToOne: false
            referencedRelation: "catalogue_clips"
            referencedColumns: ["id", "user_id", "model", "assignment"]
          },
          {
            foreignKeyName: "catalogue_offer_clips_offer_id_user_id_model_fkey"
            columns: ["offer_id", "user_id", "model"]
            isOneToOne: false
            referencedRelation: "catalogue_offers"
            referencedColumns: ["id", "user_id", "model"]
          },
        ]
      }
      catalogue_offers: {
        Row: {
          created_at: string
          desktop_key: string | null
          desktop_source: Json | null
          id: string
          model: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          desktop_key?: string | null
          desktop_source?: Json | null
          id?: string
          model: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          desktop_key?: string | null
          desktop_source?: Json | null
          id?: string
          model?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      closer_analytics_connections: {
        Row: {
          last_attempt_at: string
          last_error: string | null
          last_synced_at: string | null
          secret_id: string
          user_id: string
          verified: boolean
        }
        Insert: {
          last_attempt_at?: string
          last_error?: string | null
          last_synced_at?: string | null
          secret_id: string
          user_id: string
          verified?: boolean
        }
        Update: {
          last_attempt_at?: string
          last_error?: string | null
          last_synced_at?: string | null
          secret_id?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: []
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
          content_type: string
          cover_storage_path: string | null
          created_at: string
          destination: string
          first_comment: string
          highlight_enabled: boolean
          highlight_name: string
          hook: string
          id: string
          imported_at: string | null
          last_publish_error: string | null
          manifest_version: number
          media_cleaned_at: string | null
          media_cleanup_after: string | null
          media_manifest: Json
          media_sha256: string | null
          planned_for: string | null
          post_key: string
          primary_media_alt_texts: string[]
          primary_media_storage_paths: string[]
          publish_attempts: number
          publish_lease_until: string | null
          publish_mode: string
          publish_started_at: string | null
          published_at: string | null
          quality_report: Json
          reel_storage_path: string | null
          review_note: string | null
          scheduled_for: string | null
          share_to_feed: boolean
          status: string
          story_link_label: string
          story_link_url: string
          story_publish_mode: string
          story_storage_path: string | null
          target_ig_user_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alt_text?: string
          approved_at?: string | null
          approved_by?: string | null
          batch_key?: string | null
          caption?: string
          content_pillar?: string
          content_type?: string
          cover_storage_path?: string | null
          created_at?: string
          destination?: string
          first_comment?: string
          highlight_enabled?: boolean
          highlight_name?: string
          hook?: string
          id?: string
          imported_at?: string | null
          last_publish_error?: string | null
          manifest_version?: number
          media_cleaned_at?: string | null
          media_cleanup_after?: string | null
          media_manifest?: Json
          media_sha256?: string | null
          planned_for?: string | null
          post_key: string
          primary_media_alt_texts?: string[]
          primary_media_storage_paths?: string[]
          publish_attempts?: number
          publish_lease_until?: string | null
          publish_mode?: string
          publish_started_at?: string | null
          published_at?: string | null
          quality_report?: Json
          reel_storage_path?: string | null
          review_note?: string | null
          scheduled_for?: string | null
          share_to_feed?: boolean
          status?: string
          story_link_label?: string
          story_link_url?: string
          story_publish_mode?: string
          story_storage_path?: string | null
          target_ig_user_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alt_text?: string
          approved_at?: string | null
          approved_by?: string | null
          batch_key?: string | null
          caption?: string
          content_pillar?: string
          content_type?: string
          cover_storage_path?: string | null
          created_at?: string
          destination?: string
          first_comment?: string
          highlight_enabled?: boolean
          highlight_name?: string
          hook?: string
          id?: string
          imported_at?: string | null
          last_publish_error?: string | null
          manifest_version?: number
          media_cleaned_at?: string | null
          media_cleanup_after?: string | null
          media_manifest?: Json
          media_sha256?: string | null
          planned_for?: string | null
          post_key?: string
          primary_media_alt_texts?: string[]
          primary_media_storage_paths?: string[]
          publish_attempts?: number
          publish_lease_until?: string | null
          publish_mode?: string
          publish_started_at?: string | null
          published_at?: string | null
          quality_report?: Json
          reel_storage_path?: string | null
          review_note?: string | null
          scheduled_for?: string | null
          share_to_feed?: boolean
          status?: string
          story_link_label?: string
          story_link_url?: string
          story_publish_mode?: string
          story_storage_path?: string | null
          target_ig_user_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      content_publications: {
        Row: {
          attempts: number
          channel: string
          content_post_id: string
          created_at: string
          depends_on_channel: string | null
          id: string
          last_error: string | null
          permalink: string | null
          platform_child_container_ids: string[]
          platform_container_id: string | null
          platform_media_id: string | null
          published_at: string | null
          published_ig_user_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel: string
          content_post_id: string
          created_at?: string
          depends_on_channel?: string | null
          id?: string
          last_error?: string | null
          permalink?: string | null
          platform_child_container_ids?: string[]
          platform_container_id?: string | null
          platform_media_id?: string | null
          published_at?: string | null
          published_ig_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: string
          content_post_id?: string
          created_at?: string
          depends_on_channel?: string | null
          id?: string
          last_error?: string | null
          permalink?: string | null
          platform_child_container_ids?: string[]
          platform_container_id?: string | null
          platform_media_id?: string | null
          published_at?: string | null
          published_ig_user_id?: string | null
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
      content_review_events: {
        Row: {
          action: string
          created_at: string
          id: number
          item_id: string
          revision: number
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: never
          item_id: string
          revision: number
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: never
          item_id?: string
          revision?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_review_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "content_review_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_review_items: {
        Row: {
          bytes: number | null
          caption: string
          created_at: string
          id: string
          media_path: string
          model: string
          note: string
          notification: string
          publish_post_id: string | null
          reviewed_at: string | null
          revision: number
          sha256: string | null
          status: string
          telegram_message_id: number | null
          title: string
          user_id: string
        }
        Insert: {
          bytes?: number | null
          caption?: string
          created_at?: string
          id?: string
          media_path: string
          model: string
          note?: string
          notification?: string
          publish_post_id?: string | null
          reviewed_at?: string | null
          revision?: number
          sha256?: string | null
          status?: string
          telegram_message_id?: number | null
          title: string
          user_id: string
        }
        Update: {
          bytes?: number | null
          caption?: string
          created_at?: string
          id?: string
          media_path?: string
          model?: string
          note?: string
          notification?: string
          publish_post_id?: string | null
          reviewed_at?: string | null
          revision?: number
          sha256?: string | null
          status?: string
          telegram_message_id?: number | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_review_items_publish_post_id_fkey"
            columns: ["publish_post_id"]
            isOneToOne: true
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
      fanvue_connections: {
        Row: {
          connected: boolean
          handle: string | null
          last_attempt_at: string | null
          last_error: string | null
          last_synced_at: string | null
          lease_id: string | null
          lease_until: string
          needs_reconnect: boolean
          refresh_pending: boolean
          secret_id: string
          user_id: string
        }
        Insert: {
          connected?: boolean
          handle?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          lease_id?: string | null
          lease_until?: string
          needs_reconnect?: boolean
          refresh_pending?: boolean
          secret_id: string
          user_id: string
        }
        Update: {
          connected?: boolean
          handle?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          lease_id?: string | null
          lease_until?: string
          needs_reconnect?: boolean
          refresh_pending?: boolean
          secret_id?: string
          user_id?: string
        }
        Relationships: []
      }
      fanvue_oauth_states: {
        Row: {
          browser_hash: string
          expires_at: string
          state_hash: string
          user_id: string
          verifier: string
        }
        Insert: {
          browser_hash: string
          expires_at: string
          state_hash: string
          user_id: string
          verifier: string
        }
        Update: {
          browser_hash?: string
          expires_at?: string
          state_hash?: string
          user_id?: string
          verifier?: string
        }
        Relationships: []
      }
      generation_uploads: {
        Row: {
          created_at: string
          id: string
          model: string
          path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          model: string
          path: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          model?: string
          path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_uploads_user_id_model_fkey"
            columns: ["user_id", "model"]
            isOneToOne: false
            referencedRelation: "model_pipeline_profiles"
            referencedColumns: ["user_id", "model"]
          },
        ]
      }
      ig_comment_redirect_settings: {
        Row: {
          activated_at: string | null
          last_received_at: string | null
          mode: string
          test_reply_once_until: string | null
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          last_received_at?: string | null
          mode?: string
          test_reply_once_until?: string | null
          user_id: string
        }
        Update: {
          activated_at?: string | null
          last_received_at?: string | null
          mode?: string
          test_reply_once_until?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ig_comment_redirect_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "ig_dm_redirect_settings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ig_connections: {
        Row: {
          api_base_url: string
          created_at: string
          destination: string
          granted_scopes: string[]
          id: string
          ig_user_id: string
          ig_username: string
          last_error: string | null
          login_type: string
          page_access_token: string
          page_id: string | null
          status: string
          token_expires_at: string
          token_refreshed_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_base_url?: string
          created_at?: string
          destination?: string
          granted_scopes?: string[]
          id?: string
          ig_user_id: string
          ig_username: string
          last_error?: string | null
          login_type?: string
          page_access_token: string
          page_id?: string | null
          status?: string
          token_expires_at: string
          token_refreshed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_base_url?: string
          created_at?: string
          destination?: string
          granted_scopes?: string[]
          id?: string
          ig_user_id?: string
          ig_username?: string
          last_error?: string | null
          login_type?: string
          page_access_token?: string
          page_id?: string | null
          status?: string
          token_expires_at?: string
          token_refreshed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ig_dm_redirect_contacts: {
        Row: {
          last_attempt_at: string | null
          opted_out: boolean
          previous_variant: number | null
          sender_id: string
          user_id: string
        }
        Insert: {
          last_attempt_at?: string | null
          opted_out?: boolean
          previous_variant?: number | null
          sender_id: string
          user_id: string
        }
        Update: {
          last_attempt_at?: string | null
          opted_out?: boolean
          previous_variant?: number | null
          sender_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ig_dm_redirect_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "ig_dm_redirect_settings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ig_dm_redirect_receipts: {
        Row: {
          error_code: string | null
          event_at: string
          finished_at: string | null
          message_hash: string
          provider_message_id: string | null
          received_at: string
          sender_id: string
          source: string
          status: string
          user_id: string
          variant: number | null
        }
        Insert: {
          error_code?: string | null
          event_at: string
          finished_at?: string | null
          message_hash: string
          provider_message_id?: string | null
          received_at?: string
          sender_id: string
          source?: string
          status: string
          user_id: string
          variant?: number | null
        }
        Update: {
          error_code?: string | null
          event_at?: string
          finished_at?: string | null
          message_hash?: string
          provider_message_id?: string | null
          received_at?: string
          sender_id?: string
          source?: string
          status?: string
          user_id?: string
          variant?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ig_dm_redirect_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "ig_dm_redirect_settings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ig_dm_redirect_settings: {
        Row: {
          activated_at: string | null
          last_received_at: string | null
          mode: string
          receiver_id: string
          test_username: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          last_received_at?: string | null
          mode?: string
          receiver_id: string
          test_username?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          last_received_at?: string | null
          mode?: string
          receiver_id?: string
          test_username?: string
          user_id?: string
        }
        Relationships: []
      }
      ig_oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          destination: string
          dm_redirect: boolean
          expires_at: string
          redirect_uri: string
          requested_scopes: string[] | null
          state: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          destination?: string
          dm_redirect?: boolean
          expires_at: string
          redirect_uri: string
          requested_scopes?: string[] | null
          state: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          destination?: string
          dm_redirect?: boolean
          expires_at?: string
          redirect_uri?: string
          requested_scopes?: string[] | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      instagram_analytics_state: {
        Row: {
          last_attempt_at: string
          last_error: string | null
          last_synced_at: string | null
          reels: Json
          user_id: string
          warnings: Json
        }
        Insert: {
          last_attempt_at?: string
          last_error?: string | null
          last_synced_at?: string | null
          reels?: Json
          user_id: string
          warnings?: Json
        }
        Update: {
          last_attempt_at?: string
          last_error?: string | null
          last_synced_at?: string | null
          reels?: Json
          user_id?: string
          warnings?: Json
        }
        Relationships: []
      }
      model_alert_channels: {
        Row: {
          bot_ready: boolean
          chat_id: string
          checked_at: string | null
          enabled: boolean
          enabled_since: string
          ig_user_id: string | null
          ig_username: string | null
          model: string
          user_id: string
        }
        Insert: {
          bot_ready?: boolean
          chat_id: string
          checked_at?: string | null
          enabled?: boolean
          enabled_since?: string
          ig_user_id?: string | null
          ig_username?: string | null
          model: string
          user_id: string
        }
        Update: {
          bot_ready?: boolean
          chat_id?: string
          checked_at?: string | null
          enabled?: boolean
          enabled_since?: string
          ig_user_id?: string | null
          ig_username?: string | null
          model?: string
          user_id?: string
        }
        Relationships: []
      }
      model_alert_worker_health: {
        Row: {
          last_tick: string | null
          singleton: boolean
        }
        Insert: {
          last_tick?: string | null
          singleton?: boolean
        }
        Update: {
          last_tick?: string | null
          singleton?: boolean
        }
        Relationships: []
      }
      model_channel_alerts: {
        Row: {
          chat_id: string
          created_at: string
          delete_after: string | null
          delete_attempts: number
          error_code: string | null
          id: string
          lease: string | null
          lease_until: string | null
          message_id: number | null
          model: string
          permalink: string
          publication_id: string
          retry_at: string | null
          send_day: string | null
          sent_at: string | null
          state: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          delete_after?: string | null
          delete_attempts?: number
          error_code?: string | null
          id?: string
          lease?: string | null
          lease_until?: string | null
          message_id?: number | null
          model: string
          permalink: string
          publication_id: string
          retry_at?: string | null
          send_day?: string | null
          sent_at?: string | null
          state?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          delete_after?: string | null
          delete_attempts?: number
          error_code?: string | null
          id?: string
          lease?: string | null
          lease_until?: string | null
          message_id?: number | null
          model?: string
          permalink?: string
          publication_id?: string
          retry_at?: string | null
          send_day?: string | null
          sent_at?: string | null
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_channel_alerts_model_fkey"
            columns: ["model"]
            isOneToOne: false
            referencedRelation: "model_alert_channels"
            referencedColumns: ["model"]
          },
          {
            foreignKeyName: "model_channel_alerts_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: true
            referencedRelation: "content_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      model_pipeline_external_spend: {
        Row: {
          cents: number
          day: string
          reference: string
          user_id: string
        }
        Insert: {
          cents: number
          day: string
          reference: string
          user_id: string
        }
        Update: {
          cents?: number
          day?: string
          reference?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_pipeline_external_spend_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "model_pipeline_settings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      model_pipeline_jobs: {
        Row: {
          attempt: number
          created_at: string
          duration: number | null
          id: string
          inbox_id: string | null
          issue: string | null
          lease: string | null
          lease_until: string | null
          model: string
          parent_job_id: string | null
          prompt_id: string | null
          provider_id: string | null
          reference_profile: string
          reserved_cents: number
          reserved_day: string | null
          review_id: string | null
          revision_caption: string | null
          revision_notes: string
          revision_of_review_id: string | null
          source_sha256: string | null
          source_upload_id: string | null
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          duration?: number | null
          id?: string
          inbox_id?: string | null
          issue?: string | null
          lease?: string | null
          lease_until?: string | null
          model: string
          parent_job_id?: string | null
          prompt_id?: string | null
          provider_id?: string | null
          reference_profile: string
          reserved_cents?: number
          reserved_day?: string | null
          review_id?: string | null
          revision_caption?: string | null
          revision_notes?: string
          revision_of_review_id?: string | null
          source_sha256?: string | null
          source_upload_id?: string | null
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          duration?: number | null
          id?: string
          inbox_id?: string | null
          issue?: string | null
          lease?: string | null
          lease_until?: string | null
          model?: string
          parent_job_id?: string | null
          prompt_id?: string | null
          provider_id?: string | null
          reference_profile?: string
          reserved_cents?: number
          reserved_day?: string | null
          review_id?: string | null
          revision_caption?: string | null
          revision_notes?: string
          revision_of_review_id?: string | null
          source_sha256?: string | null
          source_upload_id?: string | null
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_pipeline_jobs_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "reel_inbox_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_pipeline_jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "model_pipeline_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_pipeline_jobs_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "content_review_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_pipeline_jobs_revision_of_review_id_fkey"
            columns: ["revision_of_review_id"]
            isOneToOne: true
            referencedRelation: "content_review_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_pipeline_jobs_source_upload_id_user_id_model_fkey"
            columns: ["source_upload_id", "user_id", "model"]
            isOneToOne: false
            referencedRelation: "generation_uploads"
            referencedColumns: ["id", "user_id", "model"]
          },
          {
            foreignKeyName: "model_pipeline_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "model_pipeline_settings"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "model_pipeline_jobs_user_id_model_fkey"
            columns: ["user_id", "model"]
            isOneToOne: false
            referencedRelation: "model_pipeline_profiles"
            referencedColumns: ["user_id", "model"]
          },
        ]
      }
      model_pipeline_profiles: {
        Row: {
          intake_after: string
          model: string
          sender_username: string | null
          user_id: string
        }
        Insert: {
          intake_after?: string
          model: string
          sender_username?: string | null
          user_id: string
        }
        Update: {
          intake_after?: string
          model?: string
          sender_username?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_pipeline_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "model_pipeline_settings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      model_pipeline_settings: {
        Row: {
          daily_cents: number
          enabled: boolean
          last_seen_at: string | null
          resolution: string
          user_id: string
          worker_hash: string | null
        }
        Insert: {
          daily_cents?: number
          enabled?: boolean
          last_seen_at?: string | null
          resolution?: string
          user_id: string
          worker_hash?: string | null
        }
        Update: {
          daily_cents?: number
          enabled?: boolean
          last_seen_at?: string | null
          resolution?: string
          user_id?: string
          worker_hash?: string | null
        }
        Relationships: []
      }
      model_posting_policies: {
        Row: {
          daily_limit: number
          model: string
          slots: string[]
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          daily_limit?: number
          model: string
          slots?: string[]
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          daily_limit?: number
          model?: string
          slots?: string[]
          timezone?: string
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
      reel_inbox_devices: {
        Row: {
          expires_at: string
          instance_id: string | null
          last_seen_at: string | null
          revoked: boolean
          token_hash: string
          user_id: string
        }
        Insert: {
          expires_at?: string
          instance_id?: string | null
          last_seen_at?: string | null
          revoked?: boolean
          token_hash: string
          user_id: string
        }
        Update: {
          expires_at?: string
          instance_id?: string | null
          last_seen_at?: string | null
          revoked?: boolean
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      reel_inbox_dm_candidates: {
        Row: {
          created_at: string
          inbox_id: string
          model: string
          user_id: string
        }
        Insert: {
          created_at?: string
          inbox_id: string
          model: string
          user_id: string
        }
        Update: {
          created_at?: string
          inbox_id?: string
          model?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reel_inbox_dm_candidates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "reel_inbox_dm_sources"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reel_inbox_dm_candidates_user_id_inbox_id_fkey"
            columns: ["user_id", "inbox_id"]
            isOneToOne: false
            referencedRelation: "reel_inbox_items"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      reel_inbox_dm_claims: {
        Row: {
          claim_id: string
          created_at: string
          inbox_id: string
          message_hash: string | null
          model: string
          user_id: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          inbox_id: string
          message_hash?: string | null
          model: string
          user_id: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          inbox_id?: string
          message_hash?: string | null
          model?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reel_inbox_dm_claims_user_id_inbox_id_fkey"
            columns: ["user_id", "inbox_id"]
            isOneToOne: false
            referencedRelation: "reel_inbox_items"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reel_inbox_dm_claims_user_id_message_hash_fkey"
            columns: ["user_id", "message_hash"]
            isOneToOne: false
            referencedRelation: "reel_inbox_dm_receipts"
            referencedColumns: ["user_id", "message_hash"]
          },
        ]
      }
      reel_inbox_dm_receipts: {
        Row: {
          diagnostics: Json | null
          explicit_model: string | null
          link_count: number
          message_at: string | null
          message_hash: string
          model: string | null
          paired_message_hash: string | null
          received_at: string
          routing_locked: boolean
          routing_status: string
          sender: string
          status: string
          user_id: string
        }
        Insert: {
          diagnostics?: Json | null
          explicit_model?: string | null
          link_count: number
          message_at?: string | null
          message_hash: string
          model?: string | null
          paired_message_hash?: string | null
          received_at?: string
          routing_locked?: boolean
          routing_status?: string
          sender: string
          status: string
          user_id: string
        }
        Update: {
          diagnostics?: Json | null
          explicit_model?: string | null
          link_count?: number
          message_at?: string | null
          message_hash?: string
          model?: string | null
          paired_message_hash?: string | null
          received_at?: string
          routing_locked?: boolean
          routing_status?: string
          sender?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reel_inbox_dm_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "reel_inbox_dm_sources"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reel_inbox_dm_senders: {
        Row: {
          sender_id: string
          user_id: string
          username: string
        }
        Insert: {
          sender_id: string
          user_id: string
          username: string
        }
        Update: {
          sender_id?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "reel_inbox_dm_senders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "reel_inbox_dm_sources"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reel_inbox_dm_sources: {
        Row: {
          enabled: boolean
          last_received_at: string | null
          receiver_id: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          last_received_at?: string | null
          receiver_id: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          last_received_at?: string | null
          receiver_id?: string
          user_id?: string
        }
        Relationships: []
      }
      reel_inbox_items: {
        Row: {
          api_resolve_lease: string | null
          attempts: number
          available_at: string
          canonical_url: string
          confirmed_stage: string | null
          created_at: string
          desired_stage: string
          error_code: string | null
          id: string
          is_test: boolean
          lease_id: string | null
          lease_until: string | null
          receipt: Json | null
          shortcode: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_resolve_lease?: string | null
          attempts?: number
          available_at?: string
          canonical_url: string
          confirmed_stage?: string | null
          created_at?: string
          desired_stage?: string
          error_code?: string | null
          id?: string
          is_test?: boolean
          lease_id?: string | null
          lease_until?: string | null
          receipt?: Json | null
          shortcode: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_resolve_lease?: string | null
          attempts?: number
          available_at?: string
          canonical_url?: string
          confirmed_stage?: string | null
          created_at?: string
          desired_stage?: string
          error_code?: string | null
          id?: string
          is_test?: boolean
          lease_id?: string | null
          lease_until?: string | null
          receipt?: Json | null
          shortcode?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      review_card_sync: {
        Row: {
          applied: number
          claimed_version: number | null
          item_id: string
          lease: string | null
          lease_until: string | null
          retry_at: string
          wanted: number
        }
        Insert: {
          applied?: number
          claimed_version?: number | null
          item_id: string
          lease?: string | null
          lease_until?: string | null
          retry_at?: string
          wanted?: number
        }
        Update: {
          applied?: number
          claimed_version?: number | null
          item_id?: string
          lease?: string | null
          lease_until?: string | null
          retry_at?: string
          wanted?: number
        }
        Relationships: [
          {
            foreignKeyName: "review_card_sync_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "content_review_items"
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
      sl_batches: {
        Row: {
          campaign_id: string
          created_at: string
          fingerprint: Json
          id: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          fingerprint: Json
          id: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          fingerprint?: Json
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sl_batches_campaign_id_user_id_fkey"
            columns: ["campaign_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sl_campaigns"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sl_campaigns: {
        Row: {
          created_at: string
          id: string
          name: string
          status: string
          template: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          status?: string
          template?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          status?: string
          template?: string
          user_id?: string
        }
        Relationships: []
      }
      sl_events: {
        Row: {
          country: string
          created_at: string
          device: string
          id: string
          kind: string
          link_id: string
          referrer: string
          visitor_hash: string | null
        }
        Insert: {
          country?: string
          created_at?: string
          device: string
          id: string
          kind: string
          link_id: string
          referrer: string
          visitor_hash?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          device?: string
          id?: string
          kind?: string
          link_id?: string
          referrer?: string
          visitor_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sl_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "sl_links"
            referencedColumns: ["id"]
          },
        ]
      }
      sl_limits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        Insert: {
          hits: number
          key: string
          window_start: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      sl_links: {
        Row: {
          account_id: string | null
          active: boolean
          batch_id: string
          campaign_id: string
          created_at: string
          domain: string
          id: string
          provider: string
          provider_error: string | null
          provider_started_at: string | null
          provider_state: string
          recipient_id: string | null
          short_url: string | null
          slug: string
          target: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          batch_id: string
          campaign_id: string
          created_at?: string
          domain: string
          id?: string
          provider?: string
          provider_error?: string | null
          provider_started_at?: string | null
          provider_state?: string
          recipient_id?: string | null
          short_url?: string | null
          slug: string
          target: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          batch_id?: string
          campaign_id?: string
          created_at?: string
          domain?: string
          id?: string
          provider?: string
          provider_error?: string | null
          provider_started_at?: string | null
          provider_state?: string
          recipient_id?: string | null
          short_url?: string | null
          slug?: string
          target?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sl_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ig_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sl_links_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "sl_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sl_links_campaign_id_user_id_fkey"
            columns: ["campaign_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sl_campaigns"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "sl_links_recipient_id_user_id_fkey"
            columns: ["recipient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sl_recipients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sl_messages: {
        Row: {
          body: string
          campaign_id: string
          created_at: string
          error_code: string | null
          id: string
          link_id: string
          recipient_id: string
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          body: string
          campaign_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          link_id: string
          recipient_id: string
          sent_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          body?: string
          campaign_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          link_id?: string
          recipient_id?: string
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sl_messages_campaign_id_user_id_fkey"
            columns: ["campaign_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sl_campaigns"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "sl_messages_link_id_user_id_fkey"
            columns: ["link_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sl_links"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "sl_messages_recipient_id_user_id_fkey"
            columns: ["recipient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sl_recipients"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sl_recipients: {
        Row: {
          campaign_id: string
          consent: string
          consent_at: string
          created_at: string
          evidence: string
          handle: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          consent: string
          consent_at?: string
          created_at?: string
          evidence?: string
          handle: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          consent?: string
          consent_at?: string
          created_at?: string
          evidence?: string
          handle?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sl_recipients_campaign_id_user_id_fkey"
            columns: ["campaign_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sl_campaigns"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sl_suppressions: {
        Row: {
          created_at: string
          handle: string
          user_id: string
        }
        Insert: {
          created_at?: string
          handle: string
          user_id: string
        }
        Update: {
          created_at?: string
          handle?: string
          user_id?: string
        }
        Relationships: []
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
      wavespeed_analytics_state: {
        Row: {
          last_attempt_at: string
          last_error: string | null
          last_synced_at: string | null
          ledger: Json | null
          report: Json | null
          requested_at: string
          user_id: string
        }
        Insert: {
          last_attempt_at?: string
          last_error?: string | null
          last_synced_at?: string | null
          ledger?: Json | null
          report?: Json | null
          requested_at?: string
          user_id: string
        }
        Update: {
          last_attempt_at?: string
          last_error?: string | null
          last_synced_at?: string | null
          ledger?: Json | null
          report?: Json | null
          requested_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wavespeed_monthly_reports: {
        Row: {
          ledger: Json
          month: string
          observed_at: string
          report: Json
          user_id: string
        }
        Insert: {
          ledger: Json
          month: string
          observed_at: string
          report: Json
          user_id: string
        }
        Update: {
          ledger?: Json
          month?: string
          observed_at?: string
          report?: Json
          user_id?: string
        }
        Relationships: []
      }
      wavespeed_task_attributions: {
        Row: {
          evidence: string
          model: string
          provider_id: string
          user_id: string
          verified_at: string
        }
        Insert: {
          evidence: string
          model: string
          provider_id: string
          user_id: string
          verified_at?: string
        }
        Update: {
          evidence?: string
          model?: string
          provider_id?: string
          user_id?: string
          verified_at?: string
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
      approve_content_batch: { Args: { _batch_key: string }; Returns: number }
      business_live_status: { Args: { p_user: string }; Returns: Json }
      can_access_asset: { Args: { _asset_id: string }; Returns: boolean }
      catalogue_offer_command: {
        Args: { p_action: string; p_data?: Json; p_user: string }
        Returns: Json
      }
      catalogue_snapshot:
        | {
            Args: {
              p_clip_page?: number
              p_review_page?: number
              p_user: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_clip_page: number
              p_filters: Json
              p_review_page: number
              p_user: string
            }
            Returns: Json
          }
      claim_due_content_post: {
        Args: { _content_post_id?: string; _user_id?: string }
        Returns: string
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
      closer_analytics_secret_get: { Args: { p_user: string }; Returns: string }
      closer_analytics_secret_put: {
        Args: { p_token: string; p_user: string }
        Returns: undefined
      }
      confirm_content_handoff: {
        Args: { _channel: string; _content_post_id: string }
        Returns: undefined
      }
      content_review_command: {
        Args: { p_action: string; p_payload?: Json; p_user: string }
        Returns: Json
      }
      fanvue_secret_get: { Args: { p_user: string }; Returns: Json }
      fanvue_secret_put: {
        Args: { p_lease?: string; p_user: string; p_value: Json }
        Returns: undefined
      }
      generation_source_check: {
        Args: { p_data: Json; p_user: string }
        Returns: Json
      }
      generation_submit: {
        Args: { p_action: string; p_data: Json; p_user: string }
        Returns: Json
      }
      generation_submit_core: {
        Args: { p_action: string; p_data: Json; p_user: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ig_comment_redirect_reserve: {
        Args: {
          p_event_at: string
          p_hash: string
          p_receiver: string
          p_sender: string
          p_trigger: boolean
          p_username: string
        }
        Returns: Json
      }
      ig_dm_redirect_reserve: {
        Args: {
          p_event_at: string
          p_hash: string
          p_receiver: string
          p_sender: string
          p_stop: boolean
          p_username: string
        }
        Returns: Json
      }
      import_catalogue_desktop: {
        Args: {
          p_offers: Json
          p_preview?: boolean
          p_user: string
          p_videos: Json
        }
        Returns: Json
      }
      is_operator: { Args: { _user_id: string }; Returns: boolean }
      is_workspace_owner: { Args: { _user_id: string }; Returns: boolean }
      model_alert_command: {
        Args: { p_action: string; p_data?: Json; p_user?: string }
        Returns: Json
      }
      model_next_posting_slot: {
        Args: { p_after?: string; p_model: string; p_user: string }
        Returns: string
      }
      model_pipeline_command: {
        Args: {
          p_action: string
          p_data?: Json
          p_user?: string
          p_worker_hash?: string
        }
        Returns: Json
      }
      model_posting_policy: {
        Args: { p_model: string; p_user: string }
        Returns: {
          daily_limit: number
          slots: string[]
          timezone: string
        }[]
      }
      model_publish_command: {
        Args: { p_action: string; p_data: Json; p_user: string }
        Returns: Json
      }
      model_publish_immediate_command: {
        Args: { p_action: string; p_data: Json; p_user: string }
        Returns: Json
      }
      owns_monitor_account: { Args: { _account_id: string }; Returns: boolean }
      owns_or_is_admin: { Args: { _owner: string }; Returns: boolean }
      promote_review_item_to_clip: {
        Args: {
          p_clip_code: string
          p_pipeline_job_id?: string
          p_review_item_id: string
          p_user: string
        }
        Returns: Json
      }
      provider_budget_usage: {
        Args: { _end: string; _start: string }
        Returns: Json
      }
      purge_ig_oauth_states: { Args: never; Returns: undefined }
      reel_inbox_command: {
        Args: {
          p_action: string
          p_device_hash?: string
          p_payload: Json
          p_user: string
        }
        Returns: Json
      }
      reel_inbox_dm_ingest: {
        Args: {
          p_hash: string
          p_links: Json
          p_receiver: string
          p_sender: string
          p_username: string
        }
        Returns: Json
      }
      reel_inbox_dm_ingest_v2: {
        Args: {
          p_diagnostics: Json
          p_hash: string
          p_links: Json
          p_receiver: string
          p_sender: string
          p_username: string
        }
        Returns: Json
      }
      reel_inbox_dm_ingest_v3: {
        Args: {
          p_diagnostics: Json
          p_hash: string
          p_links: Json
          p_model: string
          p_receiver: string
          p_sender: string
          p_username: string
        }
        Returns: Json
      }
      reel_inbox_dm_ingest_v4: {
        Args: {
          p_diagnostics: Json
          p_hash: string
          p_links: Json
          p_message_at: string
          p_model: string
          p_receiver: string
          p_sender: string
          p_username: string
        }
        Returns: Json
      }
      reel_inbox_dm_reassign: {
        Args: {
          p_from_model: string
          p_inbox: string
          p_to_model: string
          p_user: string
        }
        Returns: Json
      }
      reel_inbox_resolve_source: {
        Args: { p_device_hash: string; p_id: string; p_lease: string }
        Returns: Json
      }
      release_content_publish_lease: {
        Args: { _content_post_id: string }
        Returns: undefined
      }
      review_card_sync_command: {
        Args: { p_action: string; p_data?: Json; p_user: string }
        Returns: Json
      }
      review_content_post: {
        Args: { _content_post_id: string; _decision: string; _note?: string }
        Returns: undefined
      }
      schedule_content_post: {
        Args: { _content_post_id: string; _scheduled_for: string }
        Returns: undefined
      }
      set_catalogue_clip_assignment: {
        Args: {
          p_assignment: string
          p_clip_id: string
          p_expected_assignment: string
          p_user: string
        }
        Returns: Json
      }
      sl_analytics: { Args: { p: Json; p_user: string }; Returns: Json }
      sl_command: {
        Args: { p?: Json; p_action: string; p_user: string }
        Returns: Json
      }
      sl_provider_claim: {
        Args: { p_provider: string; p_user: string }
        Returns: Json
      }
      sl_provider_stats: { Args: { p?: Json; p_user: string }; Returns: Json }
      sl_purge: { Args: never; Returns: undefined }
      sl_rate: {
        Args: { p_key: string; p_max: number; p_seconds: number }
        Returns: boolean
      }
      verify_publisher_cron_secret: {
        Args: { _candidate: string }
        Returns: boolean
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
