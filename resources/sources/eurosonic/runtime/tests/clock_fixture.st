PROGRAM MAIN
VAR
    UtcNow : DT;
    Valid : BOOL;
    ReadStatus : DINT;
    WriteStatus : DINT;
    SetClock : BOOL := FALSE;
    SetEdge : R_TRIG;
    BlinkTimer : TON;
END_VAR
VAR RETAIN
    RetainedCounter : UDINT := 42;
END_VAR
VAR
    Lamp AT %QX120.6 : BOOL;
END_VAR
SetEdge(CLK := SetClock);
IF SetEdge.Q THEN
    WriteStatus := ES_SET_DATETIME(DT#2026-11-23-12:00:00);
END_IF;
UtcNow := ES_GET_DATETIME(VALID => Valid, STATUS => ReadStatus);
IF Valid THEN
    UtcNow := ES_GET_DATETIME();
END_IF;
BlinkTimer(IN := NOT BlinkTimer.Q, PT := T#500ms);
IF BlinkTimer.Q THEN Lamp := NOT Lamp; END_IF;
END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
TASK task0(INTERVAL := T#10ms, PRIORITY := 1);
PROGRAM instance0 WITH task0 : MAIN;
END_RESOURCE
END_CONFIGURATION
