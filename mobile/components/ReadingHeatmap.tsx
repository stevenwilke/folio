import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  activityDates: string[];
}

function getColor(count: number) {
  if (count === 0) return 'rgba(0,0,0,0.04)';
  if (count === 1) return 'rgba(90,122,90,0.3)';
  if (count === 2) return 'rgba(90,122,90,0.5)';
  return 'rgba(90,122,90,0.75)';
}

export default function ReadingHeatmap({ activityDates }: Props) {
  const today = new Date();
  const dateCountMap: Record<string, number> = {};
  for (const d of activityDates) {
    dateCountMap[d] = (dateCountMap[d] || 0) + 1;
  }

  // Build 26-week grid (half year for mobile)
  const startOffset = 26 * 7 + today.getDay();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - startOffset + 1);

  const weeks: { date: string; count: number }[][] = [];
  let current = new Date(startDate);
  let week: { date: string; count: number }[] = [];

  while (current <= today) {
    const dateStr = current.toISOString().slice(0, 10);
    week.push({ date: dateStr, count: dateCountMap[dateStr] || 0 });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    current.setDate(current.getDate() + 1);
  }
  if (week.length > 0) weeks.push(week);

  const CELL = 10;
  const GAP = 2;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.grid}>
          {weeks.map((w, wi) => (
            <View key={wi} style={styles.column}>
              {w.map(day => (
                <View
                  key={day.date}
                  style={[styles.cell, { width: CELL, height: CELL, backgroundColor: getColor(day.count) }]}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.legend}>
        <Text style={styles.legendText}>Less</Text>
        {[0, 1, 2, 3].map(n => (
          <View key={n} style={[styles.cell, { width: CELL, height: CELL, backgroundColor: getColor(n) }]} />
        ))}
        <Text style={styles.legendText}>More</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 2 },
  column: { gap: 2 },
  cell: { borderRadius: 2 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3, justifyContent: 'flex-end', marginTop: 6 },
  legendText: { fontSize: 9, color: Colors.muted },
});
