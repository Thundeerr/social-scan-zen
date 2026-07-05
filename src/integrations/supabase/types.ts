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
          account_id: string
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
          last_seen_at: string
          likes: number
          media_type: Database["public"]["Enums"]["asset_media_type"]
          media_url: string | null
          posted_at: string | null
          source_url: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
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
          last_seen_at?: string
          likes?: number
          media_type?: Database["public"]["Enums"]["asset_media_type"]
          media_url?: string | null
          posted_at?: string | null
          source_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
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
          last_seen_at?: string
          likes?: number
          media_type?: Database["public"]["Enums"]["asset_media_type"]
          media_url?: string | null
          posted_at?: string | null
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
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
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
          last_error: string | null
          last_scan_at: string | null
          next_scan_at: string | null
          notes: string | null
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
          last_error?: string | null
          last_scan_at?: string | null
          next_scan_at?: string | null
          notes?: string | null
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
          last_error?: string | null
          last_scan_at?: string | null
          next_scan_at?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
          username?: string
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_operator: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      account_status: "active" | "paused"
      app_role: "owner" | "cofounder"
      asset_media_type: "image" | "video" | "carousel" | "reel" | "story"
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
