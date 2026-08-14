import { describe, expect, it } from "vitest";

import { classifyProjectCategory } from "@/lib/project-category";

describe("classifyProjectCategory", () => {
  it("maps website / portal / CMS work", () => {
    expect(
      classifyProjectCategory({ title: "Website development for municipal portal" }),
    ).toBe("Website / Web Portal");
    expect(
      classifyProjectCategory({ title: "CMS for department website redesign" }),
    ).toBe("Website / Web Portal");
  });

  it("maps mobile apps", () => {
    expect(
      classifyProjectCategory({ title: "Android / iOS mobile application" }),
    ).toBe("Mobile App");
  });

  it("maps combined portal + mobile as Web + Mobile App", () => {
    expect(
      classifyProjectCategory({
        title: "Citizen portal and Android/iOS app development",
      }),
    ).toBe("Web + Mobile App");
  });

  it("maps ERP / CRM / HRMS", () => {
    expect(classifyProjectCategory({ title: "ERP implementation" })).toBe(
      "ERP / CRM / HRMS",
    );
    expect(classifyProjectCategory({ title: "HRMS and payroll system" })).toBe(
      "ERP / CRM / HRMS",
    );
  });

  it("maps cloud / SaaS", () => {
    expect(
      classifyProjectCategory({ title: "Hosted application / cloud-native SaaS platform" }),
    ).toBe("Cloud System / SaaS");
  });

  it("maps custom software and redevelopment", () => {
    expect(
      classifyProjectCategory({
        title: "Custom Bid for Services - Software Redevelopment of PLC HMI",
      }),
    ).toBe("Custom Software");
  });

  it("maps system / API integration", () => {
    expect(
      classifyProjectCategory({
        title: "JOB WORK FOR SYSTEM INTEGRATION AND DEMONSTRATION ACTIVITIES",
      }),
    ).toBe("API / System Integration");
  });

  it("maps AI / automation without industrial automatic machinery", () => {
    expect(
      classifyProjectCategory({ title: "AI chatbot and ML automation platform" }),
    ).toBe("AI / Automation");
    expect(
      classifyProjectCategory({
        title: "Software Redevelopment of Automatic Barrel Filling Machine",
      }),
    ).toBe("Custom Software");
  });

  it("maps GIS / mapping", () => {
    expect(
      classifyProjectCategory({ title: "GIS application for land records mapping" }),
    ).toBe("GIS / Mapping");
  });

  it("maps cybersecurity", () => {
    expect(
      classifyProjectCategory({
        title: "Vulnerability and penetration testing - web application, network",
      }),
    ).toBe("Cybersecurity");
    expect(
      classifyProjectCategory({ title: "Security audit / SOC / VAPT" }),
    ).toBe("Cybersecurity");
  });

  it("maps IT infrastructure", () => {
    expect(
      classifyProjectCategory({
        title: "Networking with ethernet LAN cable and data center connectivity",
      }),
    ).toBe("IT Infrastructure");
  });

  it("maps AMC / support", () => {
    expect(
      classifyProjectCategory({ title: "Custom Bid for Services - AMC for IPB TOOL" }),
    ).toBe("Support / AMC / Maintenance");
    expect(
      classifyProjectCategory({
        title: "Application support / support services / maintenance",
      }),
    ).toBe("Support / AMC / Maintenance");
  });

  it("maps manpower hiring, not hiring-of-agency wrappers", () => {
    expect(
      classifyProjectCategory({
        title:
          "Hiring of Professionals for Application Development and Maintenance",
      }),
    ).toBe("Manpower / Resource Hiring");
    expect(
      classifyProjectCategory({
        title:
          "Hiring of agency for IT projects - website re-design & development",
      }),
    ).toBe("Website / Web Portal");
  });

  it("maps software license / subscription", () => {
    expect(
      classifyProjectCategory({ title: "Renewal of Qlik Replicate license for 3 years" }),
    ).toBe("Software License / Subscription");
  });

  it("does not use eligibility text or raw titles as the category value", () => {
    const label = classifyProjectCategory({
      title: "Supply of office furniture",
      sourceCategory: "Eligibility Criteria / Requirements",
    });
    expect(label).toBe("Other");
    expect(label.length).toBeLessThan(40);
    expect(label).not.toMatch(/Eligibility|Hiring Of Professionals/i);
  });

  it("never returns the tender title", () => {
    const title =
      "Hiring Of Professionals For Application Development And Maintenance of multiple modules";
    expect(classifyProjectCategory({ title })).not.toBe(title);
  });
});
