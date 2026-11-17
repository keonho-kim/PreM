// Purpose: Compose a shadcn calendar and editable date field for one project deadline.
// Pattern: Date-only string state; UTC is used only at the DayPicker Date boundary.
// Usage: Creation and Home filters; a blank optional value means no date filter.
// Related: components/ui/calendar.tsx, calendar.ts, project-dialog.tsx.
import { useRef, useEffect, useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { ko } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { validDate } from './calendar';
function asDate(value: string) {
  if (!validDate(value)) return undefined;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
function asValue(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function calendarToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
export function DueDatePicker({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  inputTrigger = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  inputTrigger?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const focusCalendarOnOpen = useRef(false);
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      value && !validDate(value) ? '1900~9999년의 유효한 마감일을 YYYY-MM-DD로 입력하세요.' : '',
    );
  }, [value]);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => asDate(value) ?? calendarToday());
  const [year, setYear] = useState(String(month.getUTCFullYear()));
  function navigate(date: Date) {
    setMonth(date);
    setYear(String(date.getUTCFullYear()));
  }
  function focusCalendar(content: HTMLElement | null) {
    content
      ?.querySelector<HTMLElement>('[data-selected-single=true], [data-day][tabindex="0"]')
      ?.focus({ preventScroll: true });
  }
  const input = (
    <Input
      ref={inputRef}
      id={id}
      type="text"
      name="due_date"
      value={value}
      placeholder="YYYY-MM-DD"
      required={required}
      disabled={disabled}
      maxLength={10}
      pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
      autoComplete="off"
      role={inputTrigger ? 'combobox' : undefined}
      aria-autocomplete={inputTrigger ? 'none' : undefined}
      aria-describedby={inputTrigger ? `${id}-hint` : undefined}
      onKeyDown={(event) => {
        if (!inputTrigger || event.key !== 'ArrowDown' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (open) {
          focusCalendar(calendarRef.current);
        } else {
          focusCalendarOnOpen.current = true;
          navigate(asDate(value) ?? calendarToday());
          setOpen(true);
        }
      }}
      onChange={(event) => {
        const text = event.target.value;
        event.target.setCustomValidity(
          text && !validDate(text) ? '1900~9999년의 유효한 마감일을 YYYY-MM-DD로 입력하세요.' : '',
        );
        onChange(text);
        const date = asDate(text);
        if (inputTrigger && open && date) navigate(date);
      }}
    />
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) navigate(asDate(value) ?? calendarToday());
      }}
    >
      <div className="due-date-picker">
        {inputTrigger ? <PopoverTrigger asChild>{input}</PopoverTrigger> : input}
        {inputTrigger ? (
          <span id={`${id}-hint`} className="visually-hidden">
            YYYY-MM-DD 형식으로 입력하거나 아래 방향키로 달력을 선택하세요.
          </span>
        ) : (
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              disabled={disabled}
              title="마감일 달력 열기"
              aria-label="마감일 달력 열기"
            >
              <CalendarIcon aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        )}
        <PopoverContent
          ref={calendarRef}
          className="due-date-calendar"
          align="end"
          collisionPadding={8}
          aria-label="마감일 달력"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (!inputTrigger || focusCalendarOnOpen.current) {
              focusCalendar(event.target as HTMLElement);
              focusCalendarOnOpen.current = false;
            }
          }}
        >
          <div className="calendar-year">
            <Label htmlFor={`${id}-year`}>연도</Label>
            <Input
              id={`${id}-year`}
              type="number"
              min={1900}
              max={9999}
              value={year}
              onChange={(event) => {
                const text = event.target.value;
                setYear(text);
                const number = Number(text);
                if (/^\d{4}$/.test(text) && number >= 1900 && number <= 9999)
                  setMonth(new Date(Date.UTC(number, month.getUTCMonth(), 1)));
              }}
              onBlur={() => setYear(String(month.getUTCFullYear()))}
            />
          </div>
          <Calendar
            mode="single"
            locale={ko}
            labels={{
              labelPrevious: () => '이전 달',
              labelNext: () => '다음 달',
              labelMonthDropdown: () => '월',
              labelDayButton: (date, modifiers) =>
                `${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'UTC' }).format(date)}${modifiers.selected ? ', 선택됨' : ''}`,
            }}
            formatters={{ formatMonthDropdown: (date) => `${date.getUTCMonth() + 1}월` }}
            timeZone="UTC"
            today={calendarToday()}
            month={month}
            onMonthChange={navigate}
            selected={asDate(value)}
            onSelect={(date) => {
              if (!date) return;
              onChange(asValue(date));
              setOpen(false);
            }}
            startMonth={new Date(Date.UTC(1900, 0, 1))}
            endMonth={new Date(Date.UTC(9999, 11, 31))}
            captionLayout="dropdown-months"
            autoFocus={!inputTrigger}
          />
        </PopoverContent>
      </div>
    </Popover>
  );
}
