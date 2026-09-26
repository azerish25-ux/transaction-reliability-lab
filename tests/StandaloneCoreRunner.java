package lab.ledgerguard;

import java.io.PrintWriter;
import java.nio.file.*;
import java.time.Instant;

/** Offline runner only; Maven executes the same test bodies using the real Jupiter engine. */
public final class StandaloneCoreRunner {
    private StandaloneCoreRunner() { }
    public static void main(String[] args) throws Exception {
        String filter=args.length>1?args[1]:"";
        var cases=CoreCases.all().stream().filter(c -> filter.isEmpty() || c.id().equals(filter)).toList();
        if(cases.isEmpty())throw new IllegalArgumentException("No tests discovered for filter "+filter);
        int passed=0,failed=0,errors=0;StringBuilder xml=new StringBuilder();
        for(var c:cases) {
            xml.append("  <testcase classname=\"core.Standalone\" name=\"").append(escape(c.id())).append("\">");
            try {c.run().run();passed++;System.out.println("PASS "+c.id());}
            catch(AssertionError e){failed++;System.out.println("FAIL "+c.id()+" "+e);xml.append("<failure message=\"").append(escape(e.toString())).append("\"/>");}
            catch(Throwable e){errors++;System.out.println("ERROR "+c.id()+" "+e);xml.append("<error message=\"").append(escape(e.toString())).append("\"/>");}
            xml.append("</testcase>\n");
        }
        Path out=Path.of(args[0]);Files.createDirectories(out.toAbsolutePath().getParent());
        try(PrintWriter writer=new PrintWriter(Files.newBufferedWriter(out))) {
            writer.printf("<testsuite name=\"standalone-not-junit-runtime\" timestamp=\"%s\" tests=\"%d\" failures=\"%d\" errors=\"%d\" skipped=\"0\">%n",Instant.now(),cases.size(),failed,errors);
            writer.print(xml);writer.println("</testsuite>");
        }
        System.out.printf("SUMMARY tests=%d passed=%d failed=%d errors=%d skipped=0 runtime=standalone-java%n",cases.size(),passed,failed,errors);
        if(failed+errors>0)System.exit(errors>0?2:1);
    }
    private static String escape(String s){return s.replace("&","&amp;").replace("<","&lt;").replace("\"","&quot;");}
}
