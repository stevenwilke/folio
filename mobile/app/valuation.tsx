import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Pressable,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/colors';

type Mode = 'retail' | 'used';
type SortDir = 'desc' | 'asc';

interface Row {
  id: string;
  bookId: string;
  title: string;
  author: string | null;
  cover: string | null;
  price: number;
  isEbookPrice?: boolean;
}

export default function ValuationScreen() {
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = modeParam === 'used' ? 'used' : 'retail';
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editing, setEditing] = useState<Row | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: entries } = await supabase
      .from('collection_entries')
      .select('id, book_id, read_status, books (id, title, author, cover_image_url, format)')
      .eq('user_id', user.id);

    const valid = (entries ?? []).filter((e: any) =>
      e.read_status !== 'want' && e.books?.format !== 'eBook' && e.books?.format !== 'Audiobook',
    );
    const bookIds = valid.map((e: any) => e.book_id);
    if (!bookIds.length) { setRows([]); setLoading(false); return; }

    // Try with the new flag column; fall back to the original select if the migration hasn't run yet.
    let vals: any[] | null = null;
    const withFlag = await supabase
      .from('valuations')
      .select('book_id, list_price, avg_price, list_price_is_ebook')
      .in('book_id', bookIds);
    if (withFlag.error) {
      const basic = await supabase
        .from('valuations')
        .select('book_id, list_price, avg_price')
        .in('book_id', bookIds);
      vals = basic.data ?? [];
    } else {
      vals = withFlag.data ?? [];
    }

    const priceMap = new Map<string, { price: number; isEbook: boolean }>();
    (vals ?? []).forEach((v: any) => {
      const p = mode === 'retail' ? v.list_price : v.avg_price;
      if (p != null) priceMap.set(v.book_id, { price: Number(p), isEbook: !!v.list_price_is_ebook });
    });

    const next: Row[] = valid
      .map((e: any) => {
        const entry = priceMap.get(e.book_id);
        if (!entry) return null;
        return {
          id: e.id,
          bookId: e.book_id,
          title: e.books?.title ?? 'Untitled',
          author: e.books?.author ?? null,
          cover: e.books?.cover_image_url ?? null,
          price: entry.price,
          isEbookPrice: mode === 'retail' && entry.isEbook,
        } as Row;
      })
      .filter((r: Row | null): r is Row => r !== null);

    setRows(next);
    setLoading(false);
  }, [mode]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData();
    }, [fetchData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const accent = mode === 'retail' ? Colors.rust : Colors.gold;
  const title = mode === 'retail' ? 'Retail Value' : 'Used Value';
  const icon = mode === 'retail' ? '💰' : '📊';
  const total = rows.reduce((sum, r) => sum + r.price, 0);
  const sorted = [...rows].sort((a, b) =>
    sortDir === 'desc' ? b.price - a.price : a.price - b.price,
  );

  function openEdit(row: Row) {
    setEditing(row);
    setEditValue(row.price.toFixed(2));
  }

  async function saveEdit() {
    if (!editing) return;
    const parsed = parseFloat(editValue.replace(/[^0-9.]/g, ''));
    if (!(parsed > 0)) {
      Alert.alert('Invalid price', 'Enter a price greater than 0.');
      return;
    }
    setSaving(true);
    const column = mode === 'retail' ? 'list_price' : 'avg_price';
    const payload: Record<string, any> = {
      book_id: editing.bookId,
      [column]: parsed,
      fetched_at: new Date().toISOString(),
    };
    if (mode === 'retail') payload.list_price_currency = 'USD';
    const { error } = await supabase
      .from('valuations')
      .upsert(payload, { onConflict: 'book_id' });
    setSaving(false);
    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }
    setRows((prev) => prev.map((r) => r.id === editing.id ? { ...r, price: parsed } : r));
    setEditing(null);
  }

  async function exportForInsurance() {
    if (exporting) return;
    setExporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setExporting(false); return; }

      const { data: entries } = await supabase
        .from('collection_entries')
        .select('read_status, added_at, books (id, title, author, isbn_13, isbn_10, format)')
        .eq('user_id', user.id);
      const valid = (entries ?? []).filter((e: any) =>
        e.read_status !== 'want' && e.books?.format !== 'eBook' && e.books?.format !== 'Audiobook',
      );
      const bookIds = valid.map((e: any) => e.books?.id).filter(Boolean);
      if (!bookIds.length) {
        Alert.alert('Nothing to export', 'Your library is empty.');
        setExporting(false);
        return;
      }

      const { data: vals } = await supabase
        .from('valuations')
        .select('book_id, list_price, avg_price')
        .in('book_id', bookIds);
      const vmap = new Map<string, { retail: number | null; used: number | null }>();
      (vals ?? []).forEach((v: any) => {
        vmap.set(v.book_id, {
          retail: v.list_price != null ? Number(v.list_price) : null,
          used: v.avg_price != null ? Number(v.avg_price) : null,
        });
      });

      const esc = (s: any) => {
        const str = s == null ? '' : String(s);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const header = ['Title', 'Author', 'ISBN-13', 'ISBN-10', 'Format', 'Status', 'Added', 'Retail (USD)', 'Used (USD)'];
      const rowsOut: string[] = [header.join(',')];
      let retailTotal = 0;
      let usedTotal = 0;
      for (const e of valid) {
        const b = e.books as any;
        const v = vmap.get(b.id) ?? { retail: null, used: null };
        if (v.retail) retailTotal += v.retail;
        if (v.used) usedTotal += v.used;
        rowsOut.push([
          esc(b.title),
          esc(b.author),
          esc(b.isbn_13),
          esc(b.isbn_10),
          esc(b.format),
          esc(e.read_status),
          esc(e.added_at?.slice(0, 10)),
          esc(v.retail != null ? v.retail.toFixed(2) : ''),
          esc(v.used != null ? v.used.toFixed(2) : ''),
        ].join(','));
      }
      rowsOut.push('');
      rowsOut.push(`"Totals",,,,,,,${retailTotal.toFixed(2)},${usedTotal.toFixed(2)}`);

      const csv = rowsOut.join('\n');
      const today = new Date().toISOString().slice(0, 10);
      const fileUri = `${FileSystem.cacheDirectory}folio-library-${today}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'Library export (for insurance)',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Saved', `Export saved to ${fileUri}`);
      }
    } catch (e: any) {
      Alert.alert('Could not export', e?.message ?? 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <View style={styles.root}>
        <View style={[styles.summary, { borderColor: accent }]}>
          <Text style={styles.summaryIcon}>{icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.summaryAmount, { color: accent }]}>
              ${total.toFixed(2)}
            </Text>
            <Text style={styles.summaryLabel}>
              {rows.length} {rows.length === 1 ? 'book' : 'books'} priced
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.sortBtn, { borderColor: accent }]}
            activeOpacity={0.7}
            onPress={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          >
            <Ionicons
              name={sortDir === 'desc' ? 'arrow-down' : 'arrow-up'}
              size={14}
              color={accent}
            />
            <Text style={[styles.sortBtnText, { color: accent }]}>
              {sortDir === 'desc' ? 'High to low' : 'Low to high'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.exportBtn}
          activeOpacity={0.8}
          onPress={exportForInsurance}
          disabled={exporting}
        >
          {exporting ? (
            <ActivityIndicator color={Colors.rust} size="small" />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={16} color={Colors.rust} />
              <Text style={styles.exportBtnText}>Export CSV for insurance</Text>
            </>
          )}
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No {mode} prices yet</Text>
            <Text style={styles.emptyBody}>
              Valuations appear here as prices are fetched for your library.
            </Text>
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(r) => r.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />
            }
            renderItem={({ item, index }) => (
              <View style={styles.row}>
                <Text style={styles.rank}>{index + 1}</Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => router.push(`/book/${item.bookId}`)}
                  style={styles.rowMain}
                >
                  {item.cover ? (
                    <Image source={{ uri: item.cover }} style={styles.cover} />
                  ) : (
                    <View style={[styles.cover, styles.coverFallback]}>
                      <Text style={styles.coverFallbackText} numberOfLines={3}>{item.title}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                    {!!item.author && (
                      <Text style={styles.rowAuthor} numberOfLines={1}>{item.author}</Text>
                    )}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.priceBtn}
                  activeOpacity={0.7}
                  onPress={() => openEdit(item)}
                  accessibilityLabel="Edit price"
                >
                  <Text style={[styles.price, { color: accent }]}>
                    ${item.price.toFixed(2)}
                  </Text>
                  {item.isEbookPrice ? (
                    <View style={styles.ebookBadge}>
                      <Text style={styles.ebookBadgeText}>eBook price</Text>
                    </View>
                  ) : (
                    <Ionicons name="pencil" size={11} color={Colors.muted} style={{ marginTop: 2 }} />
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        <Modal
          visible={!!editing}
          transparent
          animationType="fade"
          onRequestClose={() => setEditing(null)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setEditing(null)}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ width: '100%', alignItems: 'center' }}
            >
              <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.modalTitle} numberOfLines={2}>
                  Edit {mode === 'retail' ? 'retail' : 'used'} price
                </Text>
                {!!editing && (
                  <Text style={styles.modalSubtitle} numberOfLines={2}>
                    {editing.title}
                  </Text>
                )}
                <View style={styles.inputRow}>
                  <Text style={styles.inputPrefix}>$</Text>
                  <TextInput
                    style={styles.input}
                    value={editValue}
                    onChangeText={setEditValue}
                    keyboardType="decimal-pad"
                    autoFocus
                    selectTextOnFocus
                    placeholder="0.00"
                    placeholderTextColor={Colors.muted}
                  />
                </View>
                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnSecondary]}
                    onPress={() => setEditing(null)}
                    activeOpacity={0.7}
                    disabled={saving}
                  >
                    <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: accent }]}
                    onPress={saveEdit}
                    activeOpacity={0.8}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalBtnPrimaryText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      </View>
    </>
  );
}

const FONT_SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
const FONT_SANS = Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif' });

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: Colors.card,
  },
  summaryIcon: {
    fontSize: 32,
  },
  summaryAmount: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: FONT_SERIF,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: FONT_SANS,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: Colors.card,
  },
  sortBtnText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FONT_SANS,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.rust,
    backgroundColor: Colors.rust + '14',
  },
  exportBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.rust,
    fontFamily: FONT_SANS,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '55',
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rank: {
    width: 22,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
    textAlign: 'right',
    fontFamily: FONT_SANS,
  },
  cover: {
    width: 42,
    height: 62,
    borderRadius: 4,
    backgroundColor: Colors.border + '33',
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    backgroundColor: Colors.rust + '22',
  },
  coverFallbackText: {
    fontSize: 8,
    fontWeight: '600',
    color: Colors.rust,
    textAlign: 'center',
    fontFamily: FONT_SANS,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: FONT_SERIF,
  },
  rowAuthor: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
    fontFamily: FONT_SANS,
  },
  priceBtn: {
    alignItems: 'flex-end',
    paddingLeft: 8,
    paddingVertical: 4,
  },
  price: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT_SANS,
  },
  ebookBadge: {
    marginTop: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: Colors.gold + '26',
  },
  ebookBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.gold,
    letterSpacing: 0.3,
    fontFamily: FONT_SANS,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: FONT_SERIF,
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    fontFamily: FONT_SANS,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: FONT_SERIF,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: 4,
    fontFamily: FONT_SANS,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.background,
  },
  inputPrefix: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.muted,
    marginRight: 6,
    fontFamily: FONT_SANS,
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: Colors.ink,
    paddingVertical: 12,
    fontFamily: FONT_SANS,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondary: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalBtnSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.muted,
    fontFamily: FONT_SANS,
  },
  modalBtnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    fontFamily: FONT_SANS,
  },
});
