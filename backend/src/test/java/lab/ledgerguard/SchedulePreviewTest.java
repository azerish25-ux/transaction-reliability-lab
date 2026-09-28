package lab.ledgerguard;

import lab.ledgerguard.http.ApiException;
import lab.ledgerguard.schedules.SchedulePreviewController;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SchedulePreviewTest {
    private final SchedulePreviewController controller = new SchedulePreviewController();
    private SchedulePreviewController.Preview preview(String local, String zone, String recurrence) {
        return controller.preview(new SchedulePreviewController.Request(local, zone, recurrence));
    }
    @Test void P08DUT01_halifaxGapPreservesMinutes() {
        var p = preview("2027-03-14T02:30:00", "America/Halifax", "DAILY");
        assertEquals("GAP_FORWARD", p.policy()); assertEquals("2027-03-14T03:30:00", p.resolvedLocal());
        assertEquals("-03:00", p.offset()); assertEquals("2027-03-14T06:30:00Z", p.instant());
    }
    @Test void P08DUT02_halifaxOverlapChoosesEarlierOffset() {
        var p = preview("2027-11-07T01:30:00", "America/Halifax", "WEEKLY");
        assertEquals("OVERLAP_EARLIER", p.policy()); assertEquals("-03:00", p.offset());
        assertEquals("2027-11-07T04:30:00Z", p.instant());
    }
    @Test void P08DUT03_utcIsIndependentOfMachineZone() {
        var p = preview("2027-01-10T09:30", "UTC", "ONCE");
        assertEquals("NORMAL", p.policy()); assertEquals("Z", p.offset()); assertEquals("2027-01-10T09:30:00Z", p.instant());
    }
    @Test void P08DUT04_invalidCalendarAndFractionalTimesRejected() {
        for (String value : new String[]{"2027-02-29T09:00:00", "2027-01-10T25:00:00", "2027-01-10T09:00:00.001", "2027-01-10T09:00:00Z"})
            assertThrows(ApiException.class, () -> preview(value, "UTC", "ONCE"));
    }
    @Test void P08DUT05_invalidZoneAndRecurrenceRejected() {
        assertThrows(ApiException.class, () -> preview("2027-01-10T09:00:00", "not/a-zone", "ONCE"));
        assertThrows(ApiException.class, () -> preview("2027-01-10T09:00:00", "UTC", "MONTHLY"));
    }
    @Test void P08DUT06_nullRequestRejected() { assertThrows(ApiException.class, () -> controller.preview(null)); }
}
