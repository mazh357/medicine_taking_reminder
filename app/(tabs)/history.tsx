import { router } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { filterHistory, hasActiveHistoryFilters, historyResult, type HistoryDateRange, type HistoryResult } from "../../src/features/historyFilters";
import { formatLocalTime, lifecycleLabel } from "../../src/features/labels";
import { photosForOccurrence } from "../../src/features/medicationAppApi";
import { useAppAppearance } from "../../src/state/AppAppearanceProvider";
import { useMedicationSnapshot } from "../../src/state/useMedicationSnapshot";
import { Button, Card, Choice, FunnelButton, Screen, StatusPill, spacing } from "../../src/ui";

const resultLabels: Record<HistoryResult, string> = {
  planned: "按计划",
  partial: "部分或混合",
  not_taken: "未服用",
  missed: "漏服",
  revoked: "已撤销",
};

export default function HistoryScreen() {
  const appearance = useAppAppearance();
  const snapshot = useMedicationSnapshot();
  const [dateRange, setDateRange] = useState<HistoryDateRange>("30");
  const [medicationId, setMedicationId] = useState<string | null>(null);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filtersActive = hasActiveHistoryFilters({ dateRange, medicationId, result });
  const occurrences = useMemo(
    () => filterHistory(snapshot.occurrences, { dateRange, medicationId, result }),
    [snapshot.occurrences, dateRange, medicationId, result],
  );

  return (
    <Screen
      headerRight={
        <FunnelButton
          active={filtersActive}
          expanded={filtersExpanded}
          onPress={() => setFiltersExpanded((current) => !current)}
        />
      }
      title="记录"
      subtitle="这里只显示照片、服用确认、漏服或修订等已经发生的事实。"
    >
      {filtersExpanded ? <Card title="筛选">
        <Text style={[styles.filterTitle, { color: appearance.colors.text }]}>日期</Text>
        <View style={styles.options}>
          {(["7", "30", "all"] as HistoryDateRange[]).map((value) => (
            <Choice key={value} label={{ "7": "近 7 天", "30": "近 30 天", all: "全部" }[value]} onPress={() => setDateRange(value)} selected={dateRange === value} />
          ))}
        </View>
        <Text style={[styles.filterTitle, { color: appearance.colors.text }]}>药物</Text>
        <View style={styles.options}>
          <Choice label="全部药物" onPress={() => setMedicationId(null)} selected={medicationId === null} />
          {snapshot.medications.map((medication) => (
            <Choice key={medication.id} label={medication.name} onPress={() => setMedicationId(medication.id)} selected={medicationId === medication.id} />
          ))}
        </View>
        <Text style={[styles.filterTitle, { color: appearance.colors.text }]}>结果</Text>
        <View style={styles.options}>
          <Choice label="全部结果" onPress={() => setResult(null)} selected={result === null} />
          {(Object.keys(resultLabels) as HistoryResult[]).map((value) => (
            <Choice key={value} label={resultLabels[value]} onPress={() => setResult(value)} selected={result === value} />
          ))}
        </View>
      </Card> : null}

      {occurrences.length === 0 ? (
        <Card><Text style={[styles.empty, { color: appearance.colors.muted }]}>当前筛选条件下没有实际记录。</Text></Card>
      ) : occurrences.map((occurrence) => {
        const outcome = historyResult(occurrence);
        return (
          <Card key={occurrence.id} right={<StatusPill label={outcome ? resultLabels[outcome] : lifecycleLabel[occurrence.lifecycle]} />} title={formatLocalTime(occurrence.plannedAt)}>
            <View style={styles.list}>
              {occurrence.items.map((item) => (
                <Text key={item.id} style={[styles.line, { color: appearance.colors.text }]}>
                  {item.displayName}：计划数量 {item.plannedDoseQuantity}；实际数量 {item.confirmedConsumptionQuantity === null ? "待确认" : item.confirmedConsumptionQuantity}
                </Text>
              ))}
            </View>
            <Text style={[styles.photo, { color: appearance.colors.muted }]}>照片记录：{photosForOccurrence(occurrence).length} 张</Text>
            <Button onPress={() => router.push(`/history/${occurrence.id}`)} variant="secondary">查看详情与纠错</Button>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 15, lineHeight: 22 },
  filterTitle: { fontSize: 15, fontWeight: "700", marginTop: spacing.xs },
  options: { gap: spacing.sm },
  list: { gap: spacing.xs },
  line: { fontSize: 14, lineHeight: 20 },
  photo: { fontSize: 13, lineHeight: 18 },
});
