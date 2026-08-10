import { useEffect, useRef } from "react";
import { LocaleType, LogLevel, mergeLocales, Univer, type IWorkbookData } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { Assignment, User } from "@cinder/ui";

type Props = {
  classroomId: string;
  classroomName: string;
  roster: User[];
  assignments: Assignment[];
  scores: Record<string, string>;
  submitted: (studentId: string, assignmentId: string) => boolean;
  onScoreChange: (studentId: string, assignment: Assignment, value: string) => void;
};

const storageKey = (classroomId: string) => `cinder.teacher.workbook.${classroomId}`;

function createSheetUniver(container: HTMLDivElement) {
  const univer = new Univer({
    logLevel: LogLevel.WARN,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(sheetsEnUS) },
  });
  const preset = UniverSheetsCorePreset({
    container,
    header: true,
    toolbar: true,
    formulaBar: true,
    footer: { sheetBar: true, statisticBar: true, zoomSlider: true },
  });
  preset.plugins.forEach((entry) => {
    const [plugin, options] = Array.isArray(entry) ? entry : [entry, undefined];
    univer.registerPlugin(plugin, options);
  });
  return { univer, univerAPI: FUniver.newAPI(univer) };
}

function workbookData(props: Props): Partial<IWorkbookData> {
  let saved: Partial<IWorkbookData> | null = null;
  try { saved = JSON.parse(localStorage.getItem(storageKey(props.classroomId)) ?? "null"); } catch { /* ignore damaged local data */ }
  const id = saved?.id ?? `cinder-gradebook-${props.classroomId}`;
  const sheetId = "cinder-gradebook";
  const data: Partial<IWorkbookData> = saved ?? {
    id,
    name: `${props.classroomName} gradebook`,
    appVersion: "0.25.1",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: [sheetId],
    sheets: {},
  };
  data.id = id;
  data.name = `${props.classroomName} gradebook`;
  data.sheetOrder = data.sheetOrder?.includes(sheetId) ? data.sheetOrder : [sheetId, ...(data.sheetOrder ?? [])];
  data.sheets ??= {};
  const sheet = data.sheets[sheetId] ?? { id: sheetId, name: "Gradebook" };
  sheet.id = sheetId;
  sheet.name = "Gradebook";
  sheet.rowCount = Math.max(sheet.rowCount ?? 0, props.roster.length + 40, 120);
  sheet.columnCount = Math.max(sheet.columnCount ?? 0, props.assignments.length + 12, 30);
  sheet.cellData ??= {};
  sheet.cellData[0] ??= {};
  sheet.cellData[0][0] = { v: "Student", s: { bg: { rgb: "#f0e7de" }, bl: 1 } };
  sheet.cellData[0][1] = { v: "Username", s: { bg: { rgb: "#f0e7de" }, bl: 1 } };
  props.assignments.forEach((assignment, column) => {
    sheet.cellData![0]![column + 2] = { v: `${assignment.title} / ${assignment.max_points}`, s: { bg: { rgb: "#f0e7de" }, bl: 1 } };
  });
  props.roster.forEach((student, row) => {
    const rowIndex = row + 1;
    sheet.cellData![rowIndex] ??= {};
    sheet.cellData![rowIndex]![0] = { v: student.display_name };
    sheet.cellData![rowIndex]![1] = { v: student.username };
    props.assignments.forEach((assignment, column) => {
      const key = `${student.id}:${assignment.id}`;
      const value = props.submitted(student.id, assignment.id) ? props.scores[key] : "—";
      sheet.cellData![rowIndex]![column + 2] = value === "" ? { v: null } : { v: Number.isFinite(Number(value)) ? Number(value) : value };
    });
  });
  data.sheets[sheetId] = sheet;
  return data;
}

export function UniverGradebook(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!containerRef.current) return;
    const { univer, univerAPI } = createSheetUniver(containerRef.current);
    const workbook = univerAPI.createWorkbook(workbookData(propsRef.current));
    const sheet = workbook.getSheetByName("Gradebook");
    sheet?.setColumnWidth(0, 190);
    sheet?.setColumnWidth(1, 125);
    let timer: number | undefined;
    let hydrated = false;
    window.setTimeout(() => { hydrated = true; }, 350);
    const listener = univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => {
      if (!hydrated) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const active = univerAPI.getWorkbook(workbook.getId());
        if (!active) return;
        localStorage.setItem(storageKey(propsRef.current.classroomId), JSON.stringify(active.save()));
        const gradeSheet = active.getSheetByName("Gradebook");
        if (!gradeSheet) return;
        propsRef.current.roster.forEach((student, row) => {
          propsRef.current.assignments.forEach((assignment, column) => {
            if (!propsRef.current.submitted(student.id, assignment.id)) return;
            const raw = gradeSheet.getRange(row + 1, column + 2).getValues()[0]?.[0];
            const value = raw === null || raw === undefined ? "" : String(raw);
            if (value !== (propsRef.current.scores[`${student.id}:${assignment.id}`] ?? "")) {
              propsRef.current.onScoreChange(student.id, assignment, value);
            }
          });
        });
      }, 650);
    });
    return () => {
      window.clearTimeout(timer);
      listener.dispose();
      localStorage.setItem(storageKey(propsRef.current.classroomId), JSON.stringify(workbook.save()));
      univer.dispose();
    };
  }, [props.classroomId]);

  return <div className="univer-gradebook" ref={containerRef} />;
}
