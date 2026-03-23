import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://wdafggpiyqahkktrmtem.supabase.co';

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          bio: string | null;
          is_public: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          bio?: string | null;
          is_public?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string | null;
          bio?: string | null;
          is_public?: boolean;
          created_at?: string;
        };
      };
      books: {
        Row: {
          id: string;
          title: string;
          author: string | null;
          isbn_13: string | null;
          isbn_10: string | null;
          cover_image_url: string | null;
          published_year: number | null;
          genre: string | null;
          description: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          author?: string | null;
          isbn_13?: string | null;
          isbn_10?: string | null;
          cover_image_url?: string | null;
          published_year?: number | null;
          genre?: string | null;
          description?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          author?: string | null;
          isbn_13?: string | null;
          isbn_10?: string | null;
          cover_image_url?: string | null;
          published_year?: number | null;
          genre?: string | null;
          description?: string | null;
        };
      };
      collection_entries: {
        Row: {
          id: string;
          user_id: string;
          book_id: string;
          read_status: 'owned' | 'read' | 'reading' | 'want';
          user_rating: number | null;
          review_text: string | null;
          added_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          book_id: string;
          read_status: 'owned' | 'read' | 'reading' | 'want';
          user_rating?: number | null;
          review_text?: string | null;
          added_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          book_id?: string;
          read_status?: 'owned' | 'read' | 'reading' | 'want';
          user_rating?: number | null;
          review_text?: string | null;
          added_at?: string;
        };
      };
      friendships: {
        Row: {
          id: string;
          requester_id: string;
          addressee_id: string;
          status: 'pending' | 'accepted' | 'rejected';
          created_at: string;
        };
        Insert: {
          id?: string;
          requester_id: string;
          addressee_id: string;
          status?: 'pending' | 'accepted' | 'rejected';
          created_at?: string;
        };
        Update: {
          id?: string;
          requester_id?: string;
          addressee_id?: string;
          status?: 'pending' | 'accepted' | 'rejected';
          created_at?: string;
        };
      };
      borrow_requests: {
        Row: {
          id: string;
          requester_id: string;
          owner_id: string;
          book_id: string;
          status: 'pending' | 'accepted' | 'rejected' | 'returned';
          message: string | null;
          due_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          requester_id: string;
          owner_id: string;
          book_id: string;
          status?: 'pending' | 'accepted' | 'rejected' | 'returned';
          message?: string | null;
          due_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          requester_id?: string;
          owner_id?: string;
          book_id?: string;
          status?: 'pending' | 'accepted' | 'rejected' | 'returned';
          message?: string | null;
          due_date?: string | null;
          created_at?: string;
        };
      };
      listings: {
        Row: {
          id: string;
          seller_id: string;
          book_id: string;
          price: number;
          condition: string | null;
          description: string | null;
          status: 'active' | 'sold' | 'removed';
          created_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          book_id: string;
          price: number;
          condition?: string | null;
          description?: string | null;
          status?: 'active' | 'sold' | 'removed';
          created_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
          book_id?: string;
          price?: number;
          condition?: string | null;
          description?: string | null;
          status?: 'active' | 'sold' | 'removed';
          created_at?: string;
        };
      };
    };
  };
};
