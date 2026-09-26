package lab.ledgerguard.http;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.ConstraintViolationException;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiProblems {
    public record Problem(String type, String title, int status, String code, String correlationId,
                          Map<String, String> validation) { }
    public static UUID correlation() {
        try { return UUID.fromString(MDC.get("correlationId")); }
        catch (IllegalArgumentException | NullPointerException ignored) { return UUID.randomUUID(); }
    }
    public static Problem problem(int status, String code, Map<String, String> validation) {
        String title = switch (status) {
            case 400 -> "Invalid request";
            case 401 -> "Authentication required";
            case 403 -> "Request forbidden";
            case 404 -> "Resource not found";
            case 409 -> "Request conflicts with current state";
            case 413 -> "Request is too large";
            case 429 -> "Too many authentication attempts";
            case 503 -> "Service temporarily unavailable";
            default -> "Request could not be completed";
        };
        return new Problem("urn:ledgerguard:problem:" + code, title, status, code, correlation().toString(), validation);
    }
    public static void write(ObjectMapper json, HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setHeader("Cache-Control", "no-store");
        json.writeValue(response.getOutputStream(), problem(status, code, Map.of()));
    }
    private ResponseEntity<Problem> response(int status, String code, Map<String,String> fields) {
        var builder = ResponseEntity.status(status).header("Cache-Control", "no-store")
            .header("Content-Type", "application/problem+json");
        if (status == 429) builder.header("Retry-After", "300");
        return builder.body(problem(status, code, fields));
    }
    @ExceptionHandler(ApiException.class)
    ResponseEntity<Problem> domain(ApiException failure) {
        return response(failure.status(), failure.getMessage(), Map.of());
    }
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Problem> validation(MethodArgumentNotValidException failure) {
        Map<String,String> fields = new java.util.TreeMap<>();
        failure.getBindingResult().getFieldErrors().forEach(e -> fields.put(e.getField(), "Invalid value"));
        return response(400, "VALIDATION_FAILED", fields);
    }
    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
                       ConstraintViolationException.class})
    ResponseEntity<Problem> invalid(Exception failure) { return response(400, "INVALID_REQUEST", Map.of()); }
    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Problem> absent(NoResourceFoundException failure) { return response(404, "NOT_FOUND", Map.of()); }
    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Problem> database(DataAccessException failure) {
        // Do not serialize SQL, connection strings, failed inputs or nested exception messages.
        return response(503, "DEPENDENCY_UNAVAILABLE", Map.of());
    }
}
