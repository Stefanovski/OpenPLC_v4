FUNCTION_BLOCK CounterBlock
VAR RETAIN
    Count : DINT := 42;
END_VAR
Count := Count + 1;
END_FUNCTION_BLOCK

PROGRAM MAIN
VAR RETAIN
    Counter : UDINT := 123;
    Enabled : BOOL := TRUE;
    Values : ARRAY [0..2] OF INT := [10,20,30];
END_VAR
VAR
    VolatileValue : DINT := 7;
    Nested : CounterBlock;
END_VAR
Counter := Counter + 1;
Nested();
END_PROGRAM

CONFIGURATION Config0
VAR_GLOBAL RETAIN
    GlobalCounter : UDINT := 456;
END_VAR
RESOURCE Res0 ON PLC
TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
PROGRAM instance0 WITH task0 : MAIN;
END_RESOURCE
END_CONFIGURATION
