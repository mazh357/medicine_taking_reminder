import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { Button } from "./Button";
import { colors, spacing } from "./theme";

const ITEM_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, value) => value);
const MINUTES = Array.from({ length: 60 }, (_, value) => value);
const pad = (value: number) => String(value).padStart(2, "0");

function parseTime(value: string): [number, number] {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return [8, 0];
  const [hour, minute] = value.split(":").map(Number);
  return [hour!, minute!];
}

function selectedIndex(event: NativeSyntheticEvent<NativeScrollEvent>, length: number) {
  return Math.max(0, Math.min(length - 1, Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT)));
}

function TimeColumn({ label, values, selected, onSelect }: {
  label: string;
  values: number[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  const list = useRef<FlatList<number>>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      list.current?.scrollToOffset({ offset: selected * ITEM_HEIGHT, animated: false });
    });
  }, [selected]);

  const adjust = (direction: "increment" | "decrement") => {
    const next = Math.max(0, Math.min(values.length - 1, selected + (direction === "increment" ? 1 : -1)));
    onSelect(next);
    list.current?.scrollToOffset({ offset: next * ITEM_HEIGHT, animated: true });
  };

  return (
    <View style={styles.column}>
      <Text style={styles.columnLabel}>{label}</Text>
      <View style={styles.wheel}>
        <View pointerEvents="none" style={styles.selectionFrame} />
        <FlatList
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          accessibilityLabel={label}
          accessibilityRole="adjustable"
          accessibilityValue={{ text: pad(values[selected]!) }}
          contentContainerStyle={styles.wheelContent}
          data={values}
          decelerationRate="fast"
          getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
          initialScrollIndex={selected}
          keyExtractor={(item) => `${label}-${item}`}
          onAccessibilityAction={(event) => {
            const name = event.nativeEvent.actionName;
            if (name === "increment" || name === "decrement") adjust(name);
          }}
          onMomentumScrollEnd={(event) => onSelect(selectedIndex(event, values.length))}
          onScrollEndDrag={(event) => {
            if (Math.abs(event.nativeEvent.velocity?.y ?? 0) < 0.05) onSelect(selectedIndex(event, values.length));
          }}
          ref={list}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onSelect(item);
                list.current?.scrollToOffset({ offset: item * ITEM_HEIGHT, animated: true });
              }}
              style={styles.wheelItem}
            >
              <Text style={[styles.wheelText, item === selected && styles.wheelTextSelected]}>{pad(item)}</Text>
            </Pressable>
          )}
          showsVerticalScrollIndicator={false}
          snapToAlignment="start"
          snapToInterval={ITEM_HEIGHT}
          style={styles.list}
        />
      </View>
    </View>
  );
}

export function TimePickerField({ label, value, onChange, hint }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [hour, setHour] = useState(() => parseTime(value)[0]);
  const [minute, setMinute] = useState(() => parseTime(value)[1]);

  const open = () => {
    const [nextHour, nextMinute] = parseTime(value);
    setHour(nextHour);
    setMinute(nextMinute);
    setVisible(true);
  };

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityHint="打开小时和分钟选择器"
        accessibilityLabel={`${label}，当前 ${value}`}
        accessibilityRole="button"
        onPress={open}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
      >
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.chevron}>选择</Text>
      </Pressable>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <Modal animationType="fade" onRequestClose={() => setVisible(false)} transparent visible={visible}>
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.dialog}>
            <Text accessibilityRole="header" style={styles.title}>选择提醒时间</Text>
            <View style={styles.columns}>
              <TimeColumn label="小时" onSelect={setHour} selected={hour} values={HOURS} />
              <Text accessibilityElementsHidden style={styles.separator}>:</Text>
              <TimeColumn label="分钟" onSelect={setMinute} selected={minute} values={MINUTES} />
            </View>
            <View style={styles.actions}>
              <Button onPress={() => setVisible(false)} variant="secondary">取消</Button>
              <Button onPress={() => {
                onChange(`${pad(hour)}:${pad(minute)}`);
                setVisible(false);
              }}>确定</Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 15, fontWeight: "600" },
  field: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 10, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 50, paddingHorizontal: spacing.md },
  fieldPressed: { opacity: 0.75 },
  value: { color: colors.text, fontSize: 20, fontVariant: ["tabular-nums"], fontWeight: "700" },
  chevron: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  backdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)", flex: 1, justifyContent: "center", padding: spacing.lg },
  dialog: { backgroundColor: colors.surface, borderRadius: 18, gap: spacing.md, maxWidth: 420, padding: spacing.lg, width: "100%" },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", textAlign: "center" },
  columns: { alignItems: "center", flexDirection: "row", justifyContent: "center" },
  column: { alignItems: "center", flex: 1, gap: spacing.xs },
  columnLabel: { color: colors.muted, fontSize: 14 },
  wheel: { height: ITEM_HEIGHT * 5, overflow: "hidden", position: "relative", width: "100%" },
  list: { flex: 1 },
  wheelContent: { paddingVertical: ITEM_HEIGHT * 2 },
  wheelItem: { alignItems: "center", height: ITEM_HEIGHT, justifyContent: "center" },
  wheelText: { color: colors.muted, fontSize: 20, fontVariant: ["tabular-nums"] },
  wheelTextSelected: { color: colors.text, fontSize: 24, fontWeight: "700" },
  selectionFrame: { backgroundColor: colors.primarySoft, borderRadius: 10, height: ITEM_HEIGHT, left: 0, position: "absolute", right: 0, top: ITEM_HEIGHT * 2 },
  separator: { color: colors.text, fontSize: 28, fontWeight: "700", paddingTop: 34 },
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
});
