using IssueTracker.Core;
using IssueTracker.Infrastructure;

const string FrontendCorsPolicy = "Frontend";

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCore();
builder.Services.AddInfrastructure();
builder.Services.AddHealthChecks();
builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var frontendOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .GetChildren()
    .Select(section => section.Value)
    .Where(value => !string.IsNullOrWhiteSpace(value))
    .Cast<string>()
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        if (frontendOrigins.Length > 0)
        {
            policy
                .WithOrigins(frontendOrigins)
                .AllowAnyHeader()
                .AllowAnyMethod();
        }
    });
});

var app = builder.Build();

app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger(options =>
    {
        options.RouteTemplate = "openapi/{documentName}.json";
    });
    app.UseSwaggerUI(options =>
    {
        options.RoutePrefix = "swagger";
        options.SwaggerEndpoint("/openapi/v1.json", "Issue Tracker API v1");
    });
}

app.UseCors(FrontendCorsPolicy);
app.MapHealthChecks("/health");

app.Run();

public partial class Program;
