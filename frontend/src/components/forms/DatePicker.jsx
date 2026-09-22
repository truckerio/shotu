import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker as AriaDatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
} from "react-aria-components";
import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "@untitledui/icons";
import { joinClassNames } from "./form-utils.js";
import "./date-picker.css";

function dateValue(value) {
  if (!value) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

export function DatePicker({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-required": ariaRequired,
  autoFocus = false,
  className = "",
  disabled = false,
  id,
  max,
  min,
  name,
  onBlur,
  onChange,
  onFocus,
  required = false,
  style,
  value = "",
}) {
  const selectedDate = dateValue(value);
  const label = ariaLabel || "Date";
  const isRequired = required || Boolean(ariaRequired);
  const [isOpen, setOpen] = useState(false);

  function changeDate(nextDate) {
    const nextValue = nextDate?.toString() || "";
    const target = { name, value: nextValue };
    onChange?.({ currentTarget: target, target });
  }

  function clearDate() {
    changeDate(null);
    setOpen(false);
  }

  return (
    <AriaDatePicker
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-label={label}
      aria-labelledby={ariaLabelledBy}
      className={joinClassNames("date-picker", className)}
      isDisabled={disabled}
      isInvalid={Boolean(ariaInvalid)}
      isRequired={isRequired}
      isOpen={isOpen}
      maxValue={dateValue(max)}
      minValue={dateValue(min)}
      name={name}
      onBlur={onBlur}
      onChange={changeDate}
      onFocus={onFocus}
      onOpenChange={setOpen}
      style={style}
      value={selectedDate}
    >
      <Group className="date-picker-control">
        <DateInput autoFocus={autoFocus} className="date-picker-input">
          {(segment) => <DateSegment segment={segment} />}
        </DateInput>
        <Button aria-label={`Open calendar for ${label}`} className="date-picker-trigger" id={id} onPress={(event) => event.target.focus()}>
          <CalendarIcon aria-hidden="true" />
        </Button>
      </Group>
      <Popover className="date-picker-popover" placement="bottom start">
        <Dialog aria-label={`${label} calendar`} className="date-picker-dialog">
          {selectedDate && !isRequired ? <Button className="date-picker-clear" onPress={clearDate}>Clear date</Button> : null}
          <Calendar>
            <header className="date-picker-calendar-header">
              <Button aria-label="Previous month" className="date-picker-calendar-button" slot="previous"><ChevronLeft aria-hidden="true" /></Button>
              <Heading className="date-picker-calendar-heading" />
              <Button aria-label="Next month" className="date-picker-calendar-button" slot="next"><ChevronRight aria-hidden="true" /></Button>
            </header>
            <CalendarGrid className="date-picker-calendar-grid">
              <CalendarGridHeader>{(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}</CalendarGridHeader>
              <CalendarGridBody>{(date) => <CalendarCell className="date-picker-calendar-cell" date={date} />}</CalendarGridBody>
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  );
}
