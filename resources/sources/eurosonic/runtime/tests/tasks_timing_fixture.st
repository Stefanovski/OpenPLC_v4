(* Bench fixture: no outputs and no RETAIN. SLOW deliberately consumes 20 ms
   on a 480 MHz M7; FAST must preempt it. Never use this load in production. *)
PROGRAM FAST
VAR_EXTERNAL
    FastCount : UDINT;
END_VAR
VAR
    Timer : TON;
    TimerDone : BOOL;
END_VAR
FastCount := FastCount + 1;
Timer(IN := TRUE, PT := T#500ms);
TimerDone := Timer.Q;
END_PROGRAM

PROGRAM SLOW
VAR_EXTERNAL
    FastCount : UDINT;
END_VAR
VAR
    Count : UDINT;
    Before : UDINT;
    Preemptions : UDINT;
END_VAR
Count := Count + 1;
Before := FastCount;
{{
    *(volatile unsigned int *)0xE000EDFC |= 0x01000000U;
    *(volatile unsigned int *)0xE0001000 |= 1U;
    unsigned int start_cycles = *(volatile unsigned int *)0xE0001004;
    while ((unsigned int)(*(volatile unsigned int *)0xE0001004 - start_cycles) < 9600000U) {}
}}
Preemptions := FastCount - Before;
END_PROGRAM

PROGRAM BACKGROUND
VAR
    Count : UDINT;
END_VAR
Count := Count + 1;
END_PROGRAM

CONFIGURATION Config0
VAR_GLOBAL
    FastCount : UDINT;
END_VAR
RESOURCE Res0 ON PLC
TASK task_fast(INTERVAL := T#10ms, PRIORITY := 0);
TASK task_slow(INTERVAL := T#50ms, PRIORITY := 1);
TASK task_background(INTERVAL := T#100ms, PRIORITY := 2);
PROGRAM instance0 WITH task_fast : FAST;
PROGRAM instance1 WITH task_slow : SLOW;
PROGRAM instance2 WITH task_background : BACKGROUND;
END_RESOURCE
END_CONFIGURATION
