package lab.ledgerguard.accounts;

import java.util.List;
import lab.ledgerguard.http.ApiException;

public record Page<T>(List<T> items,int limit,int offset,boolean hasMore) {
    public static void validate(int limit,int offset) {
        if(limit<1 || limit>100 || offset<0 || offset>10000) throw new ApiException(400,"INVALID_PAGINATION");
    }
    public static <T> Page<T> from(List<T> rows,int limit,int offset) {
        return new Page<>(List.copyOf(rows.subList(0,Math.min(limit,rows.size()))),limit,offset,rows.size()>limit);
    }
}
